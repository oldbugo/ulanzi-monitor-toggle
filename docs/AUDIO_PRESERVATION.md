# Preserve audio choices across monitor toggles

Disabling or enabling a monitor can unexpectedly change Windows' default playback output. This fix captures the selected audio outputs immediately before the display topology change and restores changed selections afterwards. The monitor is technically removed from the active desktop topology when disabled; its screen is not merely blanked.

## Behavior

- Capture the Console, Multimedia and Communications **playback** endpoint IDs separately, immediately before `SetDisplayConfig`. Capture the user's current choices for each operation rather than storing a fixed DAC preference in display snapshots.
- Observe defaults after the call, including a failed call that might still generate device notifications. Poll every 100 ms for at least two seconds, waiting for one second without a default change, up to three seconds. At the deadline, make one restoration pass and warn if defaults are still changing.
- Restore each changed role at most once, and verify the result. An original output must be active at capture, throughout the sampled observation window and immediately before restoration. If it becomes unavailable, skip that role for the rest of the operation. Do not restore an unavailable output or guess another device.
- Use the shared display-apply path for off, on and restore. List, snapshot, status and refused/no-op operations do not start an audio guard.
- Queue plugin toggle requests so overlapping button presses cannot capture and restore conflicting audio snapshots. A failed operation does not block the next request.
- Isolate audio read/write failures per role. Audio failures do not replace the display result; diagnostics appear in backend JSON as `audioPreservation`, and the plugin logs warnings.

No device name is hard-coded. The fix does not globally enforce iFi or continuously override later user choices. Both DACs remain connected, enabled and usable. It does not change microphones, volume, drivers or device enabled states.

## Validation on 23 October 2026

The installed plugin was tested using the physical second-monitor button, turning the Odyssey monitor off and back on with iFi selected for Console/Multimedia and Moonriver 2 selected for Communications.

| Operation | Recorded playback behavior | Communications |
| --- | --- | --- |
| Monitor off | Windows selected Moonriver 2, then playback returned to iFi about 1.97 seconds later | Stayed on Moonriver 2 |
| Monitor on | Windows selected Moonriver 2, then playback returned to iFi about 1.97 seconds later | Stayed on Moonriver 2 |

Both DACs remained available. A post-test DisplayConfig query confirmed both displays active again. The native default setter also succeeded with readback during test setup. This establishes the observed recovery on the tested Windows installation; it does not guarantee uninterrupted application audio.

Automated and non-disruptive checks passed:

- 16 C# fake-backend regression scenarios in Windows PowerShell 5.1: independent roles; unchanged defaults/no writes; missing or unavailable originals; transient disconnect; capture/query/state errors; isolated setter failure; post-write verification; cascading setters; late fallback; bounded churn; case-insensitive IDs; idempotent completion.
- Node queue test for ordering, no overlap and recovery after rejection.
- Backend and Node read-only display enumeration with the combined C# compilation unit.
- JSON validation, JavaScript syntax and Git whitespace checks.

Run `npm test`, `npm run validate:json`, `npm run backend:list` and `npm run node:list` from the repository root. These commands do not toggle monitors or set real audio defaults. Audio regression tests use a fake backend and clock.

Live coverage is limited to the second-monitor off/on cycle with split playback and communications choices. Other monitor/group buttons, unplugging the selected DAC, reverse DAC choices and behavior after Windows updates remain untested live. Standalone restore shares the tested Apply path but was not separately exercised live.

## Corrected diagnostic interpretation

Direct native `IMMDevice.GetState` queries found the Dell and Odyssey NVIDIA playback endpoints **disabled**. Native ACTIVE playback enumeration contained zero NVIDIA outputs. The underlying NVIDIA audio device/controller was enabled; that is a separate layer from a disabled playback endpoint.

A separate diagnostic logger previously read registry `DeviceState & 15`, which incorrectly labeled these endpoints active. On the inspected system, raw `0x10000001` corresponded to native state 2 (disabled). Historical masked snapshots cannot establish initial endpoint eligibility. Native notifications during the monitor test reported disabled/absent NVIDIA endpoints, with no NVIDIA ACTIVE notification. The logger was corrected separately to query native endpoint states; it is not part of this plugin.

The monitor topology change is the confirmed trigger for the reproduced output switch. The precise component or policy that selected Moonriver remains unresolved. Active NVIDIA audio outputs have not been established as the cause. The native default-device notifications and observed restoration to iFi were unaffected by the separate logger's snapshot-state bug.

## Limits

- A brief audio interruption or reroute remains possible while recovery takes place. The tested restoration took approximately two seconds after the observed default change.
- Windows default-change notifications do not identify who initiated a change. A deliberate user selection during the roughly 2–3 second observation window can also be restored. Wait for the toggle to finish before selecting another output; the guard stops afterwards.
- Reselection arriving after the observation window will not be corrected. Availability is sampled, and Windows offers no atomic availability-check-and-set operation here. Synchronous COM calls and display-driver work can add runtime beyond the bounded polling window.
- `IPolicyConfig::SetDefaultEndpoint` is an undocumented Windows interface and may change. Compatibility errors are caught and reported per role, allowing the display operation to complete. The setter worked on the tested installation; future Windows compatibility is not guaranteed.
- Existing audio streams may follow application-specific routing. The fix restores default roles, not per-application output settings. Restoring a role can also refresh Windows' preference metadata; no registry manipulation or preference reset is performed.

## Updating and rollback

Back up the installed plugin before updating, and close Ulanzi Deck for the copy. The runtime changes are confined to these four files:

- `plugin/app.js`
- `plugin/serialize-operation.js` (new)
- `scripts/WindowsDisplayControl.ps1`
- `scripts/WindowsAudioDefaults.cs` (new)

Preserve profiles, display snapshots, SDK assets and dependencies. Restart Ulanzi Deck after updating. To roll back this change, restore the original `app.js` and `WindowsDisplayControl.ps1`, remove the two files added by this update, and restart Ulanzi Deck. Source attribution and the vendored SDK license are retained.

## Primary references

- [Microsoft: default audio endpoint selection](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/default-audio-endpoint-selection): endpoint-state changes can trigger reselection; this is context, not proof of the precise cause on the tested system.
- [Microsoft: SetDisplayConfig](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setdisplayconfig): display topology API and flags.
- [Microsoft: default device change callback](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immnotificationclient-ondefaultdevicechanged): flow, role and endpoint ID, without initiator information.
- [Microsoft: GetState](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdevice-getstate) and [endpoint enumeration](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nf-mmdeviceapi-immdeviceenumerator-enumaudioendpoints): native endpoint state and eligibility.
- [Microsoft: audio device roles](https://learn.microsoft.com/en-us/windows/win32/coreaudio/device-roles-in-windows-vista): public API role-setting limitation.
- [Primary PolicyConfig declaration](https://github.com/amate/SetDefaultAudioDevice/blob/master/PolicyConfig.h): undocumented interface identity and vtable reference.
