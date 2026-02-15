import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { uploadToR2 } from "../_shared/r2-upload.ts";

const RESEND_API_URL = "https://api.resend.com";

async function downloadResendAttachment(
  resendApiKey: string,
  emailId: string,
  attachmentId: string,
  filename: string
): Promise<{ data: Uint8Array; contentType: string; filename: string } | null> {
  const url = `${RESEND_API_URL}/emails/${emailId}/attachments/${attachmentId}`;
  console.log(`Downloading attachment from Resend: ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Failed to download attachment: ${res.status} ${res.statusText}`);
    console.error(`Error body: ${errorText}`);
    return null;
  }

  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "application/octet-stream";

  return {
    data: new Uint8Array(arrayBuffer),
    contentType,
    filename,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    const { resend_email_id } = await req.json();

    if (!resend_email_id) {
      return new Response(
        JSON.stringify({ error: "Missing resend_email_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Reprocessing email: ${resend_email_id}`);

    // Fetch email record
    const { data: email, error } = await supabase
      .from("inbound_emails")
      .select("*")
      .eq("resend_email_id", resend_email_id)
      .single();

    if (error || !email) {
      return new Response(
        JSON.stringify({ error: "Email not found", details: error?.message }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const attachmentsMetadata = email.attachments || [];

    console.log(`Email has ${attachmentsMetadata.length} attachments`);
    console.log(`Attachments:`, JSON.stringify(attachmentsMetadata, null, 2));

    if (attachmentsMetadata.length === 0) {
      return new Response(
        JSON.stringify({ error: "No attachments in email record" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Extract sender info
    const from = email.from_address || "";
    const senderName = (from.match(/^([^<]+)/)?.[1] || "").trim() || from.split("@")[0];
    const senderEmail = (from.match(/<(.+)>/)?.[1] || from).trim();
    const subject = email.subject || "";

    const uploadedFiles: Array<{ name: string; type: string; size: string; url: string }> = [];
    const skippedFiles: Array<{ name: string; reason: string }> = [];
    const erroredFiles: Array<{ name: string; error: string }> = [];

    for (let i = 0; i < attachmentsMetadata.length; i++) {
      const att = attachmentsMetadata[i];
      const filename = att.filename || `attachment-${i}`;
      const contentType = att.content_type || "application/octet-stream";
      const attachmentId = att.id;

      console.log(`Processing attachment ${i + 1}/${attachmentsMetadata.length}: ${filename} (${contentType})`);

      // Skip inline images (but allow PDFs even if they have image content-type)
      if (contentType.startsWith("image/") && !filename.match(/\.(pdf|doc|docx|xls|xlsx|csv|txt)$/i)) {
        console.log(`Skipping inline image: ${filename} (${contentType})`);
        skippedFiles.push({ name: filename, reason: "inline image" });
        continue;
      }

      console.log(`Will process: ${filename} (${contentType}, attachmentId: ${attachmentId})`);

      if (!attachmentId) {
        console.error(`No attachment ID for attachment ${i}, skipping`);
        skippedFiles.push({ name: filename, reason: "no attachment ID" });
        continue;
      }

      try {
        console.log(`Attempting to download ${filename} (ID: ${attachmentId})`);
        // Download from Resend
        const downloaded = await downloadResendAttachment(resendApiKey, resend_email_id, attachmentId, filename);
        if (!downloaded) {
          console.log(`Download returned null for ${filename}`);
          erroredFiles.push({ name: filename, error: "download returned null" });
          continue;
        }
        console.log(`Successfully downloaded ${filename}: ${downloaded.data.length} bytes`);

        // Generate R2 key
        const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
        const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const r2Key = `documents/email-uploads/${datePrefix}/${sanitizedFilename}`;

        // Upload to R2
        const publicUrl = await uploadToR2(r2Key, downloaded.data, downloaded.contentType);
        console.log(`Uploaded to R2: ${r2Key} → ${publicUrl}`);

        // Create document_index entry (inactive pending admin review)
        const fileExt = filename.split(".").pop()?.toLowerCase() || "";
        const docSlug = sanitizedFilename.replace(/\.[^.]+$/, "");
        await supabase.from("document_index").insert({
          slug: `email-${datePrefix}-${docSlug}`,
          title: filename,
          description: `Uploaded via email by ${senderName} (${senderEmail}). Subject: ${subject}`,
          category: "email-upload",
          keywords: [fileExt, "email-upload", senderName.toLowerCase(), "septic", "receipt", "maintenance"],
          storage_bucket: "r2",
          storage_path: r2Key,
          source_url: publicUrl,
          file_size_bytes: downloaded.data.length,
          storage_backend: "r2",
          is_active: false, // Pending admin review
        });

        uploadedFiles.push({
          name: filename,
          type: contentType,
          size: formatFileSize(downloaded.data.length),
          url: publicUrl,
        });

        // Log R2 upload cost
        await supabase.from("api_usage_log").insert({
          vendor: "cloudflare_r2",
          category: "r2_document_upload",
          endpoint: "PutObject",
          units: 1,
          unit_type: "api_calls",
          estimated_cost_usd: 0,
          metadata: { key: r2Key, size_bytes: downloaded.data.length, source: "manual_reprocess" },
        });
      } catch (err) {
        console.error(`Error processing attachment ${filename}:`, err.message);
        erroredFiles.push({ name: filename, error: err.message });
      }
    }

    console.log(`Finished processing. uploadedFiles.length = ${uploadedFiles.length}`);

    if (uploadedFiles.length > 0) {
      // Send admin notification
      const fileListHtml = uploadedFiles
        .map((f) => `<li><strong>${f.name}</strong> (${f.size}, ${f.type})<br><a href="${f.url}">${f.url}</a></li>`)
        .join("\n");

      await supabase.functions.invoke("send-email", {
        body: {
          template: "pai_document_received",
          to: "alpacaplayhouse@gmail.com",
          data: {
            sender_name: senderName,
            sender_email: senderEmail,
            subject: subject,
            body_preview: (email.body_text || email.body_html || "").substring(0, 500),
            file_count: uploadedFiles.length,
            file_list_html: fileListHtml,
          },
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: `Successfully processed ${uploadedFiles.length} attachment(s)`,
          files: uploadedFiles,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({
          error: "No attachments were processed",
          total_attachments: attachmentsMetadata.length,
          skipped: skippedFiles,
          errors: erroredFiles,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
