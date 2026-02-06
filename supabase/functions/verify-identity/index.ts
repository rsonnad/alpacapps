/**
 * Identity Verification Edge Function
 * Receives DL photo uploads, calls Claude Vision to extract data,
 * compares to rental application, auto-approves or flags for review.
 *
 * Deploy with: supabase functions deploy verify-identity
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Parse multipart form data
    const formData = await req.formData();
    const token = formData.get('token') as string;
    const file = formData.get('file') as File;

    if (!token || !file) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: token, file' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return new Response(
        JSON.stringify({ error: 'File must be an image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate token
    const { data: tokenRecord, error: tokenError } = await supabase
      .from('upload_tokens')
      .select('*, person:person_id(id, first_name, last_name, email)')
      .eq('token', token)
      .eq('is_used', false)
      .single();

    if (tokenError || !tokenRecord) {
      return new Response(
        JSON.stringify({ error: 'Invalid or already-used upload token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This upload link has expired. Please request a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const person = tokenRecord.person as { id: string; first_name: string; last_name: string; email: string };

    // Upload image to storage
    const fileBuffer = await file.arrayBuffer();
    const ext = file.name?.split('.').pop() || 'jpg';
    const storagePath = `${tokenRecord.rental_application_id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('identity-documents')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw new Error('Failed to store document');
    }

    // Generate signed URL (private bucket)
    const { data: signedUrlData } = await supabase.storage
      .from('identity-documents')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

    const documentUrl = signedUrlData?.signedUrl || '';

    // Call Claude Vision API
    const uint8Array = new Uint8Array(fileBuffer);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    const base64Image = btoa(binaryString);

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.type,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `Extract the following information from this driver's license or state ID image.
Return ONLY valid JSON with no additional text or markdown formatting:
{
  "full_name": "Full name exactly as shown",
  "first_name": "First name",
  "last_name": "Last name",
  "date_of_birth": "YYYY-MM-DD or null if unreadable",
  "address": "Full address as shown or null",
  "dl_number": "License number or null",
  "expiration_date": "YYYY-MM-DD or null if unreadable",
  "state": "Issuing state abbreviation or null",
  "confidence": "high or medium or low"
}
If the image is not a valid ID document, return: {"error": "not_a_valid_id"}`,
            },
          ],
        }],
      }),
    });

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      console.error('Claude API error:', errBody);
      throw new Error('Failed to analyze document');
    }

    const claudeResult = await claudeResponse.json();
    const extractedText = claudeResult.content?.[0]?.text || '';

    // Parse JSON from Claude response (handle markdown code blocks)
    let cleanJson = extractedText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    let extracted: Record<string, any>;
    try {
      extracted = JSON.parse(cleanJson);
    } catch {
      console.error('Failed to parse Claude response:', extractedText);
      throw new Error('Failed to parse document data');
    }

    if (extracted.error === 'not_a_valid_id') {
      // Still store the attempt but mark as failed
      const { data: verification } = await supabase
        .from('identity_verifications')
        .insert({
          rental_application_id: tokenRecord.rental_application_id,
          person_id: tokenRecord.person_id,
          upload_token_id: tokenRecord.id,
          document_url: documentUrl,
          extraction_raw_json: extracted,
          verification_status: 'flagged',
          name_match_score: 0,
          name_match_details: 'Uploaded image is not a valid ID document',
        })
        .select()
        .single();

      // Mark token as used
      await supabase
        .from('upload_tokens')
        .update({ is_used: true, used_at: new Date().toISOString() })
        .eq('id', tokenRecord.id);

      await supabase
        .from('rental_applications')
        .update({
          identity_verification_status: 'flagged',
          identity_verification_id: verification?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tokenRecord.rental_application_id);

      return new Response(
        JSON.stringify({
          success: false,
          error: 'The uploaded image does not appear to be a valid ID document. Please try again with a clear photo of your driver\'s license.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Name comparison — use extracted first/last fields (more reliable than full_name
    // since some states format full_name as "LAST FIRST")
    const appFirst = (person.first_name || '').trim().toLowerCase();
    const appLast = (person.last_name || '').trim().toLowerCase();
    const dlFirst = (extracted.first_name || '').trim().toLowerCase();
    const dlLast = (extracted.last_name || '').trim().toLowerCase();
    const applicationName = `${person.first_name || ''} ${person.last_name || ''}`.trim();
    const extractedName = extracted.full_name || '';
    const { score, details } = compareNameParts(appFirst, appLast, dlFirst, dlLast);

    // Check DL expiration
    const isExpired = extracted.expiration_date
      ? new Date(extracted.expiration_date) < new Date()
      : false;

    // Determine verification status
    const AUTO_APPROVE_THRESHOLD = 80;
    const verificationStatus = score >= AUTO_APPROVE_THRESHOLD && !isExpired
      ? 'auto_approved'
      : 'flagged';

    // Store verification record
    const { data: verification, error: verError } = await supabase
      .from('identity_verifications')
      .insert({
        rental_application_id: tokenRecord.rental_application_id,
        person_id: tokenRecord.person_id,
        upload_token_id: tokenRecord.id,
        document_url: documentUrl,
        document_type: 'drivers_license',
        extracted_full_name: extracted.full_name,
        extracted_first_name: extracted.first_name,
        extracted_last_name: extracted.last_name,
        extracted_dob: extracted.date_of_birth,
        extracted_address: extracted.address,
        extracted_dl_number: extracted.dl_number,
        extracted_expiration_date: extracted.expiration_date,
        extracted_state: extracted.state,
        extraction_raw_json: extracted,
        verification_status: verificationStatus,
        name_match_score: score,
        name_match_details: details,
        is_expired_dl: isExpired,
      })
      .select()
      .single();

    if (verError) {
      console.error('Error storing verification:', verError);
      throw new Error('Failed to store verification');
    }

    // Mark token as used
    await supabase
      .from('upload_tokens')
      .update({ is_used: true, used_at: new Date().toISOString() })
      .eq('id', tokenRecord.id);

    // Update rental application
    const appStatus = verificationStatus === 'auto_approved' ? 'verified' : 'flagged';
    await supabase
      .from('rental_applications')
      .update({
        identity_verification_status: appStatus,
        identity_verification_id: verification.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenRecord.rental_application_id);

    // Send emails
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const DEFAULT_FROM = Deno.env.get('EMAIL_FROM') || 'Alpaca Playhouse <auto@alpacaplayhouse.com>';

    if (RESEND_API_KEY && person.email) {
      try {
        if (verificationStatus === 'auto_approved') {
          // Send success email to applicant
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              type: 'dl_verified',
              to: person.email,
              data: { first_name: person.first_name },
            }),
          });
        } else {
          // Send mismatch alert to admin
          const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'team@alpacaplayhouse.com';
          const adminUrl = `https://rsonnad.github.io/alpacapps/spaces/admin/rentals.html`;
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              type: 'dl_mismatch',
              to: ADMIN_EMAIL,
              data: {
                applicant_name: applicationName,
                extracted_name: extractedName,
                match_score: score,
                admin_url: adminUrl,
                is_expired: isExpired,
              },
            }),
          });
        }
      } catch (emailErr) {
        console.error('Error sending verification email:', emailErr);
        // Don't fail the whole request if email fails
      }
    }

    console.log(`Identity verification completed: ${verificationStatus}, score: ${score}, for application ${tokenRecord.rental_application_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        verification_status: verificationStatus,
        name_match_score: score,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Verification error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Name comparison using extracted first/last name fields directly
// (avoids issues with state-specific full_name formatting like "LAST FIRST")
function compareNameParts(appFirst: string, appLast: string, dlFirst: string, dlLast: string): { score: number; details: string } {
  const clean = (s: string) => s.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '').trim();

  const af = clean(appFirst);
  const al = clean(appLast);
  const df = clean(dlFirst);
  const dl = clean(dlLast);

  if (!af || !al || !df || !dl) {
    return { score: 0, details: 'One or more name fields are empty' };
  }

  // Exact match
  if (af === df && al === dl) {
    return { score: 100, details: 'Exact match' };
  }

  // Check swapped names (in case first/last are reversed)
  if (af === dl && al === df) {
    return { score: 95, details: 'Names match (first/last swapped on ID)' };
  }

  // Fuzzy match on first + last
  const firstDist = levenshteinDistance(af, df);
  const lastDist = levenshteinDistance(al, dl);
  const firstScore = 1 - firstDist / Math.max(af.length, df.length, 1);
  const lastScore = 1 - lastDist / Math.max(al.length, dl.length, 1);
  let combinedScore = Math.round(firstScore * 40 + lastScore * 60);

  // Also try swapped and use the better score
  const firstDistSwap = levenshteinDistance(af, dl);
  const lastDistSwap = levenshteinDistance(al, df);
  const firstScoreSwap = 1 - firstDistSwap / Math.max(af.length, dl.length, 1);
  const lastScoreSwap = 1 - lastDistSwap / Math.max(al.length, df.length, 1);
  const swappedScore = Math.round(firstScoreSwap * 40 + lastScoreSwap * 60);

  if (swappedScore > combinedScore) {
    combinedScore = swappedScore;
    return {
      score: combinedScore,
      details: `Names match when swapped. First: ${Math.round(firstScoreSwap * 100)}%, Last: ${Math.round(lastScoreSwap * 100)}%`,
    };
  }

  return {
    score: combinedScore,
    details: `First name: ${Math.round(firstScore * 100)}% match, Last name: ${Math.round(lastScore * 100)}% match`,
  };
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}
