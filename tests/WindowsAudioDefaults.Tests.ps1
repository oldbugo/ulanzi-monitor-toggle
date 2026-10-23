# Fake-backend regression tests. Never instantiate the Windows backend or set real defaults.
# Run in a fresh Windows PowerShell 5.1 process; no Pester or other dependency required.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourcePath = Join-Path $PSScriptRoot '..\com.ulanzi.monitortoggle.ulanziPlugin\scripts\WindowsAudioDefaults.cs'
$source = Get-Content -LiteralPath $sourcePath -Raw
$tests = @'
namespace Ulanzi.MonitorToggle.Audio.Tests
{
    public sealed class FakeWaiter : IAudioWaiter
    {
        public long Milliseconds { get; private set; }
        public int Sleeps;
        public System.Action<long> OnSleep;
        public void Sleep(int milliseconds)
        {
            if (milliseconds <= 0) throw new System.Exception("Non-positive sleep");
            Milliseconds += milliseconds;
            Sleeps++;
            if (Sleeps > 100) throw new System.Exception("Unbounded polling");
            if (OnSleep != null) OnSleep(Milliseconds);
        }
    }

    public sealed class FakeBackend : IAudioDefaultsBackend
    {
        public string[] Defaults = new string[] { "playback-A", "media-B", "communications-C" };
        public readonly System.Collections.Generic.HashSet<string> Inactive = new System.Collections.Generic.HashSet<string>();
        public readonly System.Collections.Generic.List<string> Writes = new System.Collections.Generic.List<string>();
        public int FailedReadRole = -1;
        public int FailedSetRole = -1;
        public bool FailedActiveRead;
        public bool IgnoreWrites;
        public System.Action<int> AfterSet;
        public string GetDefault(int role)
        {
            if (role == FailedReadRole) throw new System.Exception("Simulated default read error");
            return Defaults[role];
        }
        public bool IsActive(string id)
        {
            if (FailedActiveRead) throw new System.Exception("Simulated state read error");
            return !Inactive.Contains(id);
        }
        public void SetDefault(string id, int role)
        {
            Writes.Add(role + ":" + id);
            if (role == FailedSetRole) throw new System.Exception("Simulated setter error");
            if (!IgnoreWrites) Defaults[role] = id;
            if (AfterSet != null) AfterSet(role);
        }
        public void Fallback() { Defaults = new string[] { "fallback", "fallback", "fallback" }; }
    }

    public static class RegressionTests
    {
        private static void Check(bool condition, string message)
        {
            if (!condition) throw new System.Exception(message);
        }
        private static void Bounded(FakeWaiter w)
        {
            Check(w.Milliseconds >= 2000 && w.Milliseconds <= 3000, "settle time outside 2-3 second bound");
        }
        public static string[] Run()
        {
            var passed = new System.Collections.Generic.List<string>();
            var b = new FakeBackend(); var w = new FakeWaiter();
            var guard = AudioDefaultsGuard.Capture(b, w);
            var report = guard.Complete();
            Check(b.Writes.Count == 0, "unchanged defaults must never be written");
            Bounded(w);
            passed.Add("unchanged defaults: no setter calls; bounded settle");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); report = guard.Complete();
            Check(b.Defaults[0] == "playback-A" && b.Defaults[1] == "media-B" && b.Defaults[2] == "communications-C", "roles were not restored independently");
            Check(b.Writes.Count == 3 && report.RestoredRoles == 3, "expected exactly one write per changed role");
            Check(report.CapturedRoles == 3, "capture count incorrect");
            Bounded(w);
            var writeCount = b.Writes.Count; var elapsed = w.Milliseconds;
            guard.Complete();
            Check(b.Writes.Count == writeCount && w.Milliseconds == elapsed, "Complete must be idempotent");
            passed.Add("independent playback/media/communications restoration; Complete idempotent");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Defaults[1] = "fallback"; report = guard.Complete();
            Check(b.Writes.Count == 1 && b.Writes[0] == "1:media-B", "unchanged roles were written");
            passed.Add("only the changed role is written");

            b = new FakeBackend(); w = new FakeWaiter(); b.Defaults[2] = null;
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); report = guard.Complete();
            Check(report.CapturedRoles == 2 && b.Writes.Count == 2 && b.Defaults[2] == "fallback", "missing captured role was guessed");
            passed.Add("missing original default is skipped without guessing");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); b.Inactive.Add("media-B"); report = guard.Complete();
            Check(b.Defaults[1] == "fallback" && b.Writes.Count == 2, "unavailable original must not be selected");
            passed.Add("unavailable original skipped; other roles restored");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback();
            var transientBackend = b;
            w.OnSleep = delegate(long now) { if (now <= 200) transientBackend.Inactive.Add("media-B"); else transientBackend.Inactive.Remove("media-B"); };
            report = guard.Complete();
            Check(b.Defaults[1] == "fallback" && b.Writes.Count == 2, "temporarily disconnected original must not be forced back");
            passed.Add("original disappearing during settle remains skipped after recovery");

            b = new FakeBackend(); w = new FakeWaiter(); b.FailedReadRole = 1;
            guard = AudioDefaultsGuard.Capture(b, w); b.FailedReadRole = -1; b.Fallback(); report = guard.Complete();
            Check(b.Writes.Count == 2 && b.Defaults[1] == "fallback", "one failed capture must not abort other roles or guess failed role");
            passed.Add("capture read failure isolated to its role");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); b.FailedReadRole = 1; report = guard.Complete();
            Check(b.Writes.Count == 2 && b.Defaults[1] == "fallback" && report.Warnings.Length > 0, "one observation error must disqualify only its role");
            passed.Add("observation read failure skips only its role");

            b = new FakeBackend(); w = new FakeWaiter(); b.Defaults = new string[3];
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); report = guard.Complete();
            Check(b.Writes.Count == 0 && w.Sleeps == 0 && report.CapturedRoles == 0, "empty capture must not guess defaults or poll needlessly");
            passed.Add("no available captured defaults: no polling or setters");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Defaults[0] = "PLAYBACK-A"; report = guard.Complete();
            Check(b.Writes.Count == 0, "endpoint ID casing alone caused a setter");
            passed.Add("endpoint IDs compare without casing sensitivity");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); b.FailedSetRole = 1; report = guard.Complete();
            Check(b.Writes.Count == 3 && b.Defaults[0] == "playback-A" && b.Defaults[2] == "communications-C", "setter failure aborted remaining roles");
            Check(report.RestoredRoles == 2 && report.Warnings.Length > 0, "setter failure not reported correctly");
            passed.Add("setter error isolated and reported; remaining roles restored");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); b.IgnoreWrites = true; report = guard.Complete();
            Check(b.Writes.Count == 3 && report.RestoredRoles == 0 && report.Warnings.Length > 0, "unverified setter success was reported as restored");
            passed.Add("post-write verification catches setters that do not take effect");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback();
            var cascadingBackend = b;
            b.AfterSet = delegate(int role) { if (role == 0) cascadingBackend.Defaults[1] = "media-B"; };
            report = guard.Complete();
            Check(b.Writes.Count == 2 && b.Writes[0] == "0:playback-A" && b.Writes[1] == "2:communications-C", "repair used stale defaults after another setter");
            passed.Add("each role re-read before repair avoids redundant cascading setters");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w); b.Fallback(); b.FailedActiveRead = true; report = guard.Complete();
            Check(b.Writes.Count == 0 && report.Warnings.Length > 0, "failed availability check must not allow writes");
            Bounded(w);
            passed.Add("availability read failure safely skips restoration");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w);
            var lateBackend = b;
            w.OnSleep = delegate(long now) { if (now >= 1700) lateBackend.Defaults[0] = "late-fallback"; };
            report = guard.Complete();
            Check(w.Milliseconds >= 2700 && w.Milliseconds <= 3000, "late change did not extend quiet settle");
            Check(b.Defaults[0] == "playback-A" && b.Writes.Count == 1, "late fallback was missed");
            passed.Add("late endpoint change extends settle and is restored once");

            b = new FakeBackend(); w = new FakeWaiter();
            guard = AudioDefaultsGuard.Capture(b, w);
            var churnBackend = b;
            w.OnSleep = delegate(long now) { churnBackend.Defaults[0] = "churn-" + now; };
            report = guard.Complete();
            Check(w.Milliseconds <= 3000 && b.Writes.Count <= 1, "continuous churn exceeded bound or repeated writes");
            passed.Add("continuous default churn is bounded with no repeated restoration");
            return passed.ToArray();
        }
    }
}
'@
Add-Type -TypeDefinition ($source + [Environment]::NewLine + $tests) -Language CSharp
$results = @([Ulanzi.MonitorToggle.Audio.Tests.RegressionTests]::Run())
$results | ForEach-Object { Write-Output "PASS $_" }
Write-Output "Passed $($results.Count) fake-backend audio tests. No Windows audio or display settings were changed."
