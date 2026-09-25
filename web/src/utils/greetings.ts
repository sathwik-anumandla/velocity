/**
 * Curated dynamic greetings for Velocity empty chat screen.
 * Categorized into 4 builder time buckets:
 * - Morning (05:00 - 11:59)
 * - Afternoon (12:00 - 16:59)
 * - Evening (17:00 - 21:59)
 * - Late Night (22:00 - 04:59)
 * Strictly NO emojis.
 */

export const MORNING_GREETINGS: string[] = [
  'Quiet morning. What shall we work on?',
  'Coffee first, problems second?',
  'Subah ho gayi. Aaj kya plan hai?',
  'Chalo, shuru karein?',
  'Kahan se shuru karein?',
  'Toh boss, kya plan hai?',
  'Chalo, kaam pe lagte hain.',
  'Good to see you. What’s on your mind?',
  'Alright, I’m here. What’s on your mind?',
  'Enough thinking. Let’s begin.',
  'Let’s make today count.',
  'We know the direction. Let’s move.',
  'Start small. Go deep.',
  'What are we cooking?',
  'What’s on the stack?',
];

export const AFTERNOON_GREETINGS: string[] = [
  'Midday push. What’s on your desk?',
  'Halfway through the day. Let’s make progress.',
  'Back at it?',
  'So, what are we thinking about today?',
  'What are we getting into today?',
  'Batao, kya karna hai?',
  'Chal bhai, let’s go.',
  'Aaj kya jugaad hai?',
  'Chalo, dimag lagate hain.',
  'Alright. Let’s figure this out.',
  'One thing at a time.',
  'Let’s make some progress.',
  'One step at a time.',
  'Let’s get moving.',
  'Alright. Let’s build.',
  'What’s today’s side quest?',
  'Which rabbit hole today?',
  'What are we figuring out?',
  'Shall we pretend we know what we’re doing?',
  'Alright, let’s make some questionable progress.',
];

export const EVENING_GREETINGS: string[] = [
  'Shaam ho gayi. Aaj kya ship karna hai?',
  'Wrapping up or just getting started?',
  'What are we shipping today?',
  'So… where were we?',
  'Theek hai, kya pakka karna hai?',
  'Toh, kya scene hai?',
  'Kya scene, boss?',
  'Picture abhi baaki hai.',
  'Let’s see how far we can take this.',
  'Let’s turn the thought into something real.',
  'One problem. One step. Go.',
  'Alright, hit me.',
  'So… what’s the mission?',
  'Alright, lock in.',
];

export const LATE_NIGHT_GREETINGS: string[] = [
  'Quiet hours. Deep work time.',
  'Late night debugging? I’m here.',
  'Burning the midnight oil. What are we fixing?',
  'Accha, aaj kya todna hai?',
  'Alright, what are we breaking today?',
  'What questionable idea are we exploring today?',
  'So, what’s the problem this time?',
  'What rabbit hole are we falling into?',
  'Another rabbit hole?',
  'What chaos are we dealing with?',
  'Okay, what happened?',
  'What are we overthinking today?',
  'Another day, another unnecessarily complicated problem.',
  'Chalo, dekhte hain.',
  'What’s been occupying your mind?',
  'Take your time. What’s up?',
  'Aaj kya explore karein?',
  'Chalo, kuch banate hain.',
  'Toh shuru karein?',
];

/**
 * Returns the current time bucket's greeting list based on local hour.
 */
export function getCurrentBucketGreetings(): string[] {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return MORNING_GREETINGS;
  }
  if (hour >= 12 && hour < 17) {
    return AFTERNOON_GREETINGS;
  }
  if (hour >= 17 && hour < 22) {
    return EVENING_GREETINGS;
  }
  return LATE_NIGHT_GREETINGS;
}

/**
 * Returns a randomized greeting from the current time bucket.
 * Avoids returning the exact same greeting consecutively.
 */
export function getGreetingForCurrentTime(previous?: string): string {
  const bucket = getCurrentBucketGreetings();
  const candidates = bucket.filter((g) => g !== previous);
  const pool = candidates.length > 0 ? candidates : bucket;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] || 'Chalo, shuru karein?';
}
