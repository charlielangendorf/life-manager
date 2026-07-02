// Content-matched icons: pick a glyph for what an entity actually IS
// (a book for reading, a runner for a run) instead of a generic bullet.
// Pure and DOM-free. Returns null when nothing matches so each view can
// fall back to its own marker (dot, node, first letter…).

const RULES = [
  [/\brun|jog|marathon|\dmi\b|\dk\b/i, '🏃'],
  [/gym|strength|lift|workout|train/i, '🏋️'],
  [/read|book|chapter|ch\.|article|paper/i, '📖'],
  [/write|journal|essay|draft|blog/i, '✍️'],
  [/call|phone/i, '📞'],
  [/email|mail|reply|inbox/i, '✉️'],
  [/meet|standup|1:1|sync|interview|coffee with/i, '🗣️'],
  [/buy|shop|order|groceries|errand/i, '🛒'],
  [/pay|bill|rent|budget|invoice|tax/i, '💳'],
  [/clean|laundry|dishes|chore|tidy/i, '🧹'],
  [/cook|dinner|lunch|breakfast|meal/i, '🍳'],
  [/doctor|dentist|health|meds|appointment/i, '🩺'],
  [/travel|flight|trip|pack|hotel/i, '✈️'],
  [/study|class|course|exam|homework|lecture/i, '🎓'],
  [/water|plant|garden/i, '🌱'],
  [/sleep|bed(time)?\b|rest/i, '😴'],
  [/stretch|yoga|breathe|meditat/i, '🧘'],
  [/code|bug|deploy|review pr|refactor/i, '💻'],
  [/music|practice|guitar|piano/i, '🎵'],
  [/walk|hike|dog/i, '🚶'],
];

export function iconFor(entity) {
  if (!entity) return null;
  const hay = `${entity.title || ''} ${(entity.tags || []).join(' ')} ${entity.project || ''}`;
  for (const [re, icon] of RULES) if (re.test(hay)) return icon;
  return null;
}
