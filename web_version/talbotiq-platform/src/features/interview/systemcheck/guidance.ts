/**
 * What the candidate reads. A pure function of (check, state, browser), so every
 * branch is exercised by a test instead of discovered by someone who could not
 * start their interview.
 *
 * The distinction this module exists to preserve: `denied` and
 * `granted-no-signal` are different problems with different fixes. The screen
 * being replaced showed the same message for both.
 */
import type { BrowserFamily } from './capabilities'
import type { CheckId } from './requirements'

/**
 * `listening` is separate from `requesting` on purpose. Permission is settled and
 * the meter is already moving; telling the candidate we are "waiting for
 * permission" at that moment would be a lie, and telling them we "can't hear
 * you" before the window has elapsed would be a false accusation.
 */
export type CheckState =
  | 'unsupported' | 'not-asked' | 'requesting' | 'listening' | 'denied' | 'granted-no-signal' | 'passed'

export interface Guidance {
  title: string
  detail: string
  steps: string[]
}

/**
 * Singular throughout: every sentence below reads "Your ${thing} is …", and
 * "your speakers is working" is the kind of thing that quietly cheapens an
 * enterprise product. "Sound" also matches the checklist label.
 */
const DEVICE_WORD: Record<CheckId, string> = {
  browser: 'browser',
  mic: 'microphone',
  camera: 'camera',
  speaker: 'sound',
  connectivity: 'connection',
}

/** Where each browser hides its site-permission controls. */
const UNBLOCK: Record<BrowserFamily, string[]> = {
  chrome: [
    'Click the icon at the left of the address bar.',
    'Set Camera and Microphone to Allow.',
    'Reload this page, then press Re-test.',
  ],
  edge: [
    'Click the padlock at the left of the address bar.',
    'Set Camera and Microphone to Allow.',
    'Reload this page, then press Re-test.',
  ],
  firefox: [
    'Click the padlock at the left of the address bar.',
    'Remove the blocked Camera or Microphone entry.',
    'Reload this page, then press Re-test.',
  ],
  safari: [
    'Open Safari → Settings for This Website.',
    'Set Camera and Microphone to Allow.',
    'Reload this page, then press Re-test.',
  ],
  samsung: [
    'Tap the padlock at the left of the address bar.',
    'Open Permissions and allow Camera and Microphone.',
    'Reload this page, then press Re-test.',
  ],
  unknown: [
    'Open your browser settings for this site.',
    'Allow Camera and Microphone access.',
    'Reload this page, then press Re-test.',
  ],
}

const WEBVIEW_STEPS = [
  'Tap the ⋯ or share menu in this window.',
  'Choose "Open in browser" (Chrome, Safari or Edge).',
  'If there is no such option, copy the link and paste it into a browser.',
]

const NO_SIGNAL: Partial<Record<CheckId, Guidance>> = {
  mic: {
    title: "We can't hear you",
    detail:
      'Your microphone is allowed, but no sound is reaching us. That usually means it is muted or the wrong input is selected.',
    steps: [
      'Check for a mute switch on your headset, and unmute your system microphone.',
      'If you have more than one microphone, pick another from the list and try again.',
      'Unplug and replug a USB or wired headset, then press Re-test.',
    ],
  },
  camera: {
    title: "We can't see you",
    detail:
      'Your camera is allowed, but no live picture is coming through. Another app may be holding it, or the lens may be covered.',
    steps: [
      'Close Zoom, Teams, Meet or any other app that may be using the camera.',
      'Remove any lens cover or privacy shutter.',
      'If you have more than one camera, pick another from the list, then press Re-test.',
    ],
  },
  speaker: {
    title: "You couldn't hear the test sound",
    detail:
      'Turn your volume up, or switch output device, then play the sound again.',
    steps: [
      'Raise your system volume and make sure nothing is muted.',
      'If you are wearing headphones, check they are connected and selected.',
      'Play the test sound again.',
    ],
  },
  connectivity: {
    title: 'Your connection may not support a live call',
    detail:
      'We could not establish the kind of connection a live interview needs. A corporate or public network may be blocking it.',
    steps: [
      'Switch to another network — a home connection or a phone hotspot.',
      'Turn off any VPN.',
      'Press Re-test.',
    ],
  },
}

export function guidanceFor(
  id: CheckId,
  state: CheckState,
  family: BrowserFamily,
  isWebview: boolean,
): Guidance {
  const thing = DEVICE_WORD[id]

  // A webview outranks everything: un-blocking instructions are useless when the
  // container will not grant media at all.
  if (isWebview && (state === 'denied' || state === 'unsupported' || state === 'granted-no-signal')) {
    return {
      title: 'Please open this in a real browser',
      detail:
        'You are viewing this inside an app’s built-in browser, which usually blocks the camera and microphone. Opening the same link in Chrome, Safari or Edge will fix it.',
      steps: WEBVIEW_STEPS,
    }
  }

  switch (state) {
    case 'unsupported':
      return {
        title: `This browser can’t use your ${thing}`,
        detail:
          'Your current browser is missing something this interview needs. The latest Chrome, Edge or Safari will work.',
        steps: [
          'Copy this page’s link.',
          'Open Chrome, Edge or Safari and paste it in.',
          'Make sure the address starts with https.',
        ],
      }
    case 'not-asked':
      return {
        title: `Check your ${thing}`,
        detail:
          id === 'speaker'
            ? 'We’ll play a short sound so you know you’ll hear the interviewer.'
            : `Your browser will ask for permission. We only use your ${thing} during this interview.`,
        steps: [],
      }
    case 'requesting':
      // The speaker check has no permission prompt — this state means the tone
      // has played and we are waiting on the one thing we cannot measure.
      return id === 'speaker'
        ? {
            title: 'Did you hear that?',
            detail: 'We played a short tone. Tell us whether it came through.',
            steps: [],
          }
        : {
            title: 'Waiting for permission',
            detail: `Choose Allow in the browser prompt to let us test your ${thing}.`,
            steps: ['The prompt usually appears near the address bar.'],
          }
    case 'listening':
      return id === 'mic'
        ? {
            title: 'Say something',
            detail: 'Read this line out loud. The bar below should move as you speak.',
            steps: [],
          }
        : id === 'camera'
          ? { title: 'Looking for a picture', detail: 'Checking that your camera is sending a live image.', steps: [] }
          : { title: 'Testing', detail: `Checking your ${thing}.`, steps: [] }
    case 'denied':
      return {
        title: `Your ${thing} is blocked`,
        detail: `This browser is refusing access to your ${thing}, so we can’t test it.`,
        steps: UNBLOCK[family],
      }
    case 'granted-no-signal':
      return (
        NO_SIGNAL[id] ?? {
          title: `Your ${thing} isn’t responding`,
          detail: `Access was allowed, but we couldn’t get a working signal from your ${thing}.`,
          steps: ['Check the device is connected and try again.'],
        }
      )
    case 'passed':
      return {
        title: `Your ${thing} is working`,
        detail:
          id === 'mic'
            ? 'We can hear you clearly.'
            : id === 'camera'
              ? 'We can see you.'
              : `Your ${thing} is ready.`,
        steps: [],
      }
  }
}
