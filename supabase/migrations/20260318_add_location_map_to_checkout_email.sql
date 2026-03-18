-- Add clock-out location map to work checkout summary email template
UPDATE email_templates SET html_template = $HTML$<h2 style="margin:0 0 4px;">Work Session Complete</h2>
<p style="margin:0 0 20px;color:#7d6f74;font-size:14px;">{{first_name}} has clocked out.</p>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f2f0e8;border:1px solid #e6e2d9;border-radius:8px;margin:0 0 20px;">
  <tr>
    <td style="padding:20px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="padding:0 0 8px;"><strong>Date:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{date}}</td>
        </tr>
        <tr>
          <td style="padding:0 0 8px;"><strong>Clock In:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{clock_in_time}}</td>
        </tr>
        <tr>
          <td style="padding:0 0 8px;"><strong>Clock Out:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{clock_out_time}}</td>
        </tr>
        <tr>
          <td style="padding:0 0 8px;"><strong>Duration:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{duration}}</td>
        </tr>
        {{#if space_name}}
        <tr>
          <td style="padding:0 0 8px;"><strong>Location:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{space_name}}</td>
        </tr>
        {{/if}}
        {{#if task_name}}
        <tr>
          <td style="padding:0 0 8px;"><strong>Task:</strong></td>
          <td style="padding:0 0 8px;text-align:right;">{{task_name}}</td>
        </tr>
        {{/if}}
        <tr>
          <td style="padding:0;border-top:1px solid #e6e2d9;padding-top:8px;"><strong>Earnings:</strong></td>
          <td style="padding:0;border-top:1px solid #e6e2d9;padding-top:8px;text-align:right;font-weight:600;color:#d4883a;">{{earnings}} <span style="font-weight:400;color:#7d6f74;font-size:13px;">@ ${{hourly_rate}}/hr</span></td>
        </tr>
      </table>
    </td>
  </tr>
</table>

{{#if description}}
<p style="margin:0 0 4px;font-weight:600;font-size:14px;">Work Description</p>
<p style="margin:0 0 20px;color:#2a1f23;">{{description}}</p>
{{/if}}

{{#if clock_out_lat}}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0;">
  <tr>
    <td>
      <p style="margin:0 0 8px;font-weight:600;font-size:14px;color:#2a1f23;">Clock-Out Location</p>
      <a href="https://www.google.com/maps?q={{clock_out_lat}},{{clock_out_lng}}" style="display:block;text-decoration:none;">
        <img src="https://staticmap.openstreetmap.de/staticmap.php?center={{clock_out_lat}},{{clock_out_lng}}&zoom=15&size=560x200&markers={{clock_out_lat}},{{clock_out_lng}},ol-marker" alt="Clock-out location map" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px;border:1px solid #e6e2d9;" />
      </a>
    </td>
  </tr>
</table>
{{else}}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0;background:#f7f6f1;border:1px solid #e6e2d9;border-radius:8px;">
  <tr>
    <td style="padding:16px 20px;text-align:center;">
      <p style="margin:0 0 6px;font-size:13px;color:#7d6f74;">Location was not available for this session.</p>
      <a href="https://alpacaplayhouse.com/associates/worktracking.html" style="display:inline-block;font-size:13px;color:#d4883a;font-weight:600;text-decoration:underline;">Enable location permissions for future sessions &rarr;</a>
    </td>
  </tr>
</table>
{{/if}}

<p style="margin:16px 0 0;color:#7d6f74;font-size:13px;">This is an automated summary from Alpaca Playhouse work tracking.</p>$HTML$,
text_template = $TEXT$Work Session Complete

{{first_name}} has clocked out.

Date: {{date}}
Clock In: {{clock_in_time}}
Clock Out: {{clock_out_time}}
Duration: {{duration}}
{{#if space_name}}Location: {{space_name}}
{{/if}}{{#if task_name}}Task: {{task_name}}
{{/if}}Earnings: {{earnings}} @ ${{hourly_rate}}/hr
{{#if description}}
Work Description: {{description}}
{{/if}}
{{#if clock_out_lat}}
Clock-Out Location: https://www.google.com/maps?q={{clock_out_lat}},{{clock_out_lng}}
{{else}}
Location not available — enable permissions at https://alpacaplayhouse.com/associates/worktracking.html
{{/if}}

This is an automated summary from Alpaca Playhouse work tracking.$TEXT$,
version = 2, updated_at = NOW()
WHERE template_key = 'work_checkout_summary' AND is_active = true;
