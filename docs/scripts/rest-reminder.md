# Rest Reminder

**Script Identifier:** `rest-reminder`  
**Current Version:** 1.1.0  
**Category:** Productivity  
**Author:** BESing Team  
**License:** MIT  
**Source Implementation:** [rest-reminder.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/scripts/rest-reminder/rest-reminder.user.js)  
**Distribution Bundle:** [besing-manager.user.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/userscript/besing-manager.user.js) | [content.js](file:///c:/Users/guanz/Desktop/project-py-NLP%20toolbox/nlp_application_toolbox/BESing/extension/content.js)

---

## 1. Summary

Rest Reminder is an ergonomic productivity tool engineered to prevent screen fatigue and repetitive eye strain through periodic rest notifications. When the configured work duration elapses, the tool displays an interactive speech chat bubble anchored directly to the floating BESing pet icon. The reminder presents two decisive actions: **Repeat** (primary action that starts the next rest interval) and **Off** (disables the reminder). The chat box remains persistent until explicitly acted upon by the user, ensuring important health breaks are not accidentally dismissed by incidental clicks or page scrolling.

---

## 2. Key Capabilities

| Feature | Description | Range / Options |
| :--- | :--- | :--- |
| **Repeating Work Interval** | Automatically counts down active work time and repeats seamlessly each time the user clicks Repeat. | Configurable via presets or custom minutes |
| **Anchored Pet Chat Bubble** | Displays as an attractive speech bubble pointing an arrow tail directly at the floating pet icon, complete with attention-drawing pulse animation. | Floating Glassmorphic Bubble attached to widget |
| **Persistent Notification** | The chat bubble stays visible across page interactions and does not auto-dismiss or close on outside clicks until user clicks Repeat or Off. | Strict user-action dismissal |
| **Interval Presets** | One-click interval selection for common ergonomic rhythms, including the standard 20-20-20 rule. | 20m (Default), 45m, 60m, Custom |
| **Custom Time Selector** | Dedicated stepper control and direct numeric input to specify any custom rest interval. | 1 to 240 minutes |
| **One Timer Everywhere** | The due time is kept in BESing's cross-site storage, so every tab and site follows the same timer, and reloads or navigation keep it. Repeat or Off on any page applies to all open pages within about 5 seconds. | Shared state `shared_rest_reminder` |
| **Test Preview Action** | Instant preview button in the settings panel to verify chat box styling and positioning. | Accessible via "Test Chat Bubble Now" |
| **Next Reminder Countdown** | The script's settings panel shows the time left until the next reminder (`M:SS`, or `H:MM:SS` past an hour) and the clock time it is due, ticking every second. It reads the shared timer every 5 seconds, so Repeat or an interval change in another tab shows up; it shows `Now` while a reminder is due and `Off` when the script is off on the site or no reminder is scheduled. | Settings panel, top section |

---

## 3. User Experience & Behavioral Design

### The 2-Button Chat Box
When the reminder triggers:
- **Widget Alert**: The floating pet icon unfolds from edge docking and activates a rhythmic glowing pulse animation (`besing-pulse-alert`).
- **Anchored Balloon**: A speech balloon appears adjacent to the icon (positioned above the icon if in the lower viewport, or below the icon if in the upper viewport), with a directional arrow tail aligned with the pet center.
- **Repeat (Primary)**: Clicking Repeat immediately dismisses the chat bubble, calculates `due = Date.now() + intervalMinutes * 60 * 1000`, stores it in the shared state, and begins the countdown for the next cycle on every page. No rest time tracking is required.
- **Off**: Clicking Off immediately dismisses the chat bubble, marks the shared state as off so other open pages stop too, and switches the script off globally, including any per-site ON rules. Switching the script back on starts a fresh cycle.

### Timer Sync
Each page with the script running re-reads the shared state every 5 seconds while it is visible, and right away when the tab becomes visible again. Hidden tabs do no work. While the reminder is due, the bubble is shown on whichever page you are on, and rebuilt if the page removed it. Without the BESing manager (standalone install) the timer falls back to `localStorage`, which is separate per site.
