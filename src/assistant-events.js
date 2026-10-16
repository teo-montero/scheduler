import { atTime, dateKey, dateParts } from './dates.js';

export const assistantSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['create_events', 'clarify', 'message'] },
    message: { type: 'string', maxLength: 2000 },
    events: { type: 'array', maxItems: 24, items: {
      type: 'object', additionalProperties: false,
      properties: {
        ...Object.fromEntries(['title', 'description', 'date', 'startTime', 'endDate', 'endTime', 'location'].map(key => [key, { type: 'string' }])),
        type: { type: 'string', enum: ['lecture', 'study', 'user_time'] }
      },
      required: ['type', 'title', 'description', 'date', 'startTime', 'endDate', 'endTime', 'location']
    } }
  }, required: ['action', 'message', 'events']
};

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function londonTime(day, time) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('The assistant returned an invalid date or time. Please try again.');
  const [hour, minute] = time.split(':').map(Number);
  const value = atTime(day, hour, minute);
  const matches = candidate => dateKey(candidate) === day && dateParts(candidate).hour === hour && dateParts(candidate).minute === minute;
  if (!Number.isFinite(+value) || !matches(value)) throw new Error('That time does not exist in London. Please choose another time.');
  // The repeated autumn hour needs an explicit choice; never guess which occurrence.
  if (matches(new Date(+value - 3600000)) || matches(new Date(+value + 3600000))) throw new Error('That time occurs twice when London clocks change. Please choose a time outside the repeated hour.');
  return value.toISOString();
}

export function validateAssistantResult(result) {
  if (!exactKeys(result, ['action', 'message', 'events']) || !['create_events', 'clarify', 'message'].includes(result.action) ||
      typeof result.message !== 'string' || !result.message.trim() || result.message.length > 2000 ||
      !Array.isArray(result.events) || result.events.length > 24 ||
      (result.action === 'create_events' ? !result.events.length : result.events.length !== 0)) throw new Error('The assistant returned an invalid response. No events were added.');
  return result.events.map(event => {
    if (!exactKeys(event, ['type', 'title', 'description', 'date', 'startTime', 'endDate', 'endTime', 'location']) ||
        !['lecture', 'study', 'user_time'].includes(event.type) || typeof event.description !== 'string' || event.description.length > 2000 ||
        typeof event.title !== 'string' || !event.title.trim() || event.title.length > 160 ||
        typeof event.location !== 'string' || event.location.length > 200) throw new Error('The assistant returned an invalid event. No events were added.');
    const start = londonTime(event.date, event.startTime), end = londonTime(event.endDate, event.endTime);
    const duration = new Date(end) - new Date(start);
    if (duration <= 0 || duration > 86400000) throw new Error('Events must end after they start and last no more than 24 hours. Please adjust your request.');
    return { type: event.type, title: event.title.trim(), description: event.description.trim(), start, end, timeZone: 'Europe/London', location: event.location.trim(), source: 'assistant' };
  });
}

// Older imported and scheduled events retain their original storage format.
export function calendarEventType(event) {
  return ['lecture', 'study', 'user_time'].includes(event.type) ? event.type : event.source === 'study' ? 'study' : event.source === 'personal' ? 'user_time' : 'lecture';
}
export function calendarEventClass(event) {
  const type = calendarEventType(event);
  return type === 'user_time' ? 'personal' : type;
}

export function prepareAssistantEvents(result, existing, makeId = () => `assistant-${crypto.randomUUID()}`) {
  const events = validateAssistantResult(result), additions = [];
  let duplicates = 0;
  for (const event of events) {
    const occupied = [...existing, ...additions];
    if (occupied.some(other => other.title.trim().toLowerCase() === event.title.toLowerCase() && +new Date(other.start) === +new Date(event.start) && +new Date(other.end) === +new Date(event.end))) { duplicates++; continue; }
    const conflict = occupied.find(other => new Date(other.start) < new Date(event.end) && new Date(other.end) > new Date(event.start));
    if (conflict) throw new Error(`“${event.title}” overlaps “${conflict.title}”. No events were added. Please choose another time.`);
    additions.push({ ...event, id: makeId() });
  }
  return { additions, duplicates };
}
