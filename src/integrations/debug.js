// Keep debugging payloads complete while masking authentication values.
export function debugData(value, secrets = []) {
  return JSON.parse(JSON.stringify(value ?? null, (key, item) => {
    if (/^(?:authorization|cookie|set-cookie|sesskey|api_?key|x-goog-api-key)$/i.test(key)) return '[redacted]';
    if (typeof item !== 'string') return item;
    for (const secret of secrets) if (secret) item = item.replaceAll(secret, '[redacted]');
    return item.replace(/([?&](?:sesskey|token|key|key_identifier)=)[^&#\s]+/gi, '$1[redacted]')
      .replace(/(\/icalendar\/)[^/?#\s]+/gi, '$1[redacted]');
  }));
}
