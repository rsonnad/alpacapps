export type WebhookClaim = "claimed" | "duplicate" | "in_progress";

export async function claimWebhookEvent(supabase: any, provider: string, eventId: string): Promise<WebhookClaim> {
  const { data: existing } = await supabase
    .from("provider_webhook_events")
    .select("status, updated_at, attempts")
    .eq("provider", provider)
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing?.status === "completed") return "duplicate";
  if (existing?.status === "failed") {
    const { error } = await supabase
      .from("provider_webhook_events")
      .update({ status: "processing", attempts: (existing.attempts || 0) + 1, updated_at: new Date().toISOString(), last_error: null })
      .eq("provider", provider)
      .eq("event_id", eventId)
      .eq("status", "failed");
    return error ? "in_progress" : "claimed";
  }
  if (existing?.status === "processing") {
    const age = Date.now() - new Date(existing.updated_at).getTime();
    if (age < 5 * 60 * 1000) return "in_progress";
    const { error } = await supabase
      .from("provider_webhook_events")
      .update({ status: "processing", attempts: (existing.attempts || 1) + 1, updated_at: new Date().toISOString(), last_error: null })
      .eq("provider", provider)
      .eq("event_id", eventId)
      .eq("status", "processing");
    return error ? "in_progress" : "claimed";
  }

  const { error: insertError } = await supabase.from("provider_webhook_events").insert({
    provider,
    event_id: eventId,
    status: "processing",
  });
  if (!insertError) return "claimed";
  if (insertError.code === "23505") return "in_progress";
  throw insertError;
}

export async function completeWebhookEvent(supabase: any, provider: string, eventId: string): Promise<void> {
  await supabase.from("provider_webhook_events").update({
    status: "completed",
    processed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error: null,
  }).eq("provider", provider).eq("event_id", eventId);
}

export async function failWebhookEvent(supabase: any, provider: string, eventId: string, error: unknown): Promise<void> {
  await supabase.from("provider_webhook_events").update({
    status: "failed",
    last_error: error instanceof Error ? error.message : String(error),
    updated_at: new Date().toISOString(),
  }).eq("provider", provider).eq("event_id", eventId);
}
