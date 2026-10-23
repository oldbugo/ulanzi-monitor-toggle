namespace Ulanzi.MonitorToggle.Audio
{
    // Keep these inside the namespace so PowerShell 5.1 can concatenate this
    // compilation unit with the display controller for one Add-Type call.
    using System;
    using System.Collections.Generic;
    using System.Diagnostics;
    using System.Runtime.InteropServices;
    using System.Threading;

    // These seams allow tests to exercise every repair path without touching Windows audio.
    public interface IAudioDefaultsBackend
    {
        string GetDefault(int role);
        bool IsActive(string endpointId);
        void SetDefault(string endpointId, int role);
    }

    public interface IAudioWaiter
    {
        long Milliseconds { get; }
        void Sleep(int milliseconds);
    }

    public sealed class AudioRestoreReport
    {
        public int CapturedRoles { get; internal set; }
        public int RestoredRoles { get; internal set; }
        public long ObservedMilliseconds { get; internal set; }
        public string[] Warnings { get; internal set; }
    }

    // One transaction only: capture immediately before SetDisplayConfig and complete in finally.
    // A default change has no reliable Windows attribution. A manual selection during this
    // short window may also be restored. Never retry setters or run this as a background policy.
    public sealed class AudioDefaultsGuard
    {
        public const int MinimumObservationMilliseconds = 2000;
        public const int MaximumObservationMilliseconds = 3000;
        public const int QuietMilliseconds = 1000;
        public const int PollMilliseconds = 100;

        private readonly IAudioDefaultsBackend backend;
        private readonly IAudioWaiter waiter;
        private readonly string[] original = new string[3];
        private readonly bool[] eligible = new bool[3];
        private readonly List<string> warnings = new List<string>();
        private readonly AudioRestoreReport report = new AudioRestoreReport();
        private bool completed;

        private AudioDefaultsGuard(IAudioDefaultsBackend backend, IAudioWaiter waiter)
        {
            this.backend = backend;
            this.waiter = waiter;
            for (int role = 0; role < 3; role++)
            {
                try
                {
                    original[role] = backend.GetDefault(role);
                    eligible[role] = !String.IsNullOrEmpty(original[role]) && backend.IsActive(original[role]);
                    if (eligible[role]) report.CapturedRoles++;
                }
                catch (Exception error) { Warn("Capture", role, error); }
            }
        }

        public static AudioDefaultsGuard Capture()
        {
            // The backend opens COM objects per call, so construction cannot prevent display work.
            return Capture(new WindowsAudioDefaultsBackend(), new SystemAudioWaiter());
        }

        public static AudioDefaultsGuard Capture(IAudioDefaultsBackend backend, IAudioWaiter waiter)
        {
            if (backend == null) throw new ArgumentNullException("backend");
            if (waiter == null) throw new ArgumentNullException("waiter");
            return new AudioDefaultsGuard(backend, waiter);
        }

        public AudioRestoreReport Complete()
        {
            if (completed) return report;
            completed = true;
            try
            {
                if (report.CapturedRoles != 0) ObserveAndRepair();
            }
            catch (Exception error) { warnings.Add("Audio preservation failed: " + error.Message); }
            finally { report.Warnings = warnings.ToArray(); }
            return report;
        }

        private void ObserveAndRepair()
        {
            long start = waiter.Milliseconds;
            long changedAt = start;
            string[] previous = null;
            while (true)
            {
                string[] current = new string[3];
                for (int role = 0; role < 3; role++)
                {
                    if (!eligible[role]) continue;
                    try
                    {
                        // Once disconnected, leave that role to Windows even if it reappears.
                        if (!backend.IsActive(original[role]))
                        {
                            eligible[role] = false;
                            warnings.Add("Original audio endpoint became unavailable for role " + role + "; left unchanged.");
                            continue;
                        }
                        current[role] = backend.GetDefault(role);
                    }
                    catch (Exception error) { eligible[role] = false; Warn("Observe", role, error); }
                }
                long now = waiter.Milliseconds;
                if (!Same(previous, current)) changedAt = now;
                previous = current;
                long elapsed = now - start;
                if (elapsed >= MaximumObservationMilliseconds)
                {
                    if (now - changedAt < QuietMilliseconds)
                        warnings.Add("Audio defaults still changing at observation deadline; one restoration attempt only.");
                    break;
                }
                if (elapsed >= MinimumObservationMilliseconds && now - changedAt >= QuietMilliseconds) break;
                waiter.Sleep((int)Math.Min(PollMilliseconds, MaximumObservationMilliseconds - elapsed));
            }
            report.ObservedMilliseconds = waiter.Milliseconds - start;

            // Exactly one attempt per role. Read again immediately before each setter, because
            // changing one role may affect another on some Windows versions/drivers.
            for (int role = 0; role < 3; role++)
            {
                if (!eligible[role]) continue;
                try
                {
                    if (!backend.IsActive(original[role]))
                    {
                        warnings.Add("Original audio endpoint unavailable at repair for role " + role + "; left unchanged.");
                        continue;
                    }
                    if (String.Equals(backend.GetDefault(role), original[role], StringComparison.OrdinalIgnoreCase)) continue;
                    backend.SetDefault(original[role], role);
                    if (String.Equals(backend.GetDefault(role), original[role], StringComparison.OrdinalIgnoreCase))
                        report.RestoredRoles++;
                    else warnings.Add("Audio default did not remain restored for role " + role + "; no retry performed.");
                }
                catch (Exception error) { Warn("Restore", role, error); }
            }
        }

        private static bool Same(string[] left, string[] right)
        {
            if (left == null) return false;
            for (int i = 0; i < 3; i++)
                if (!String.Equals(left[i], right[i], StringComparison.OrdinalIgnoreCase)) return false;
            return true;
        }

        private void Warn(string stage, int role, Exception error)
        {
            warnings.Add(stage + " audio role " + role + ": " + error.Message);
        }
    }

    internal sealed class SystemAudioWaiter : IAudioWaiter
    {
        private readonly Stopwatch stopwatch = Stopwatch.StartNew();
        public long Milliseconds { get { return stopwatch.ElapsedMilliseconds; } }
        public void Sleep(int milliseconds) { Thread.Sleep(milliseconds); }
    }

    public sealed class WindowsAudioDefaultsBackend : IAudioDefaultsBackend
    {
        public string GetDefault(int role)
        {
            IMMDeviceEnumerator enumerator = null;
            IMMDevice device = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                int result = enumerator.GetDefaultAudioEndpoint(0, role, out device);
                if (result == unchecked((int)0x80070490)) return null; // E_NOTFOUND: no default
                Marshal.ThrowExceptionForHR(result);
                string id;
                Marshal.ThrowExceptionForHR(device.GetId(out id));
                return id;
            }
            finally { Release(device); Release(enumerator); }
        }

        public bool IsActive(string endpointId)
        {
            IMMDeviceEnumerator enumerator = null;
            IMMDevice device = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                int result = enumerator.GetDevice(endpointId, out device);
                if (result == unchecked((int)0x80070490)) return false;
                Marshal.ThrowExceptionForHR(result);
                uint state;
                Marshal.ThrowExceptionForHR(device.GetState(out state));
                return (state & 1) != 0; // DEVICE_STATE_ACTIVE
            }
            finally { Release(device); Release(enumerator); }
        }

        public void SetDefault(string endpointId, int role)
        {
            // IPolicyConfig is undocumented and may change. Create it only when a repair is
            // needed; COM/Windows incompatibility is reported and never fails display changes.
            IPolicyConfig policy = null;
            try
            {
                policy = (IPolicyConfig)new PolicyConfigClient();
                Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(endpointId, role));
            }
            finally { Release(policy); }
        }

        private static void Release(object value)
        {
            if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
        }

        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        private class MMDeviceEnumerator { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
            [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
            [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
            [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activation, out IntPtr instance);
            [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
            [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetState(out uint state);
        }

        [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
        private class PolicyConfigClient { }

        // Preserve the complete vtable order. Only SetDefaultEndpoint is invoked.
        // Interface identity/order reference (not a Windows compatibility guarantee):
        // https://github.com/amate/SetDefaultAudioDevice/blob/master/PolicyConfig.h
        [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPolicyConfig
        {
            [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
            [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int isDefault, out IntPtr format);
            [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
            [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
            [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int isDefault, out long period, out long minimum);
            [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
            [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
            [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
            [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
            [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr value);
            [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
            [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
        }
    }
}
