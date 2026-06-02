[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("list", "snapshot", "disable", "enable", "restore", "is-active", "toggle")]
    [string]$Action,

    [string]$TargetKeys = "",

    [string]$SnapshotPath = "",

    [switch]$Pretty
)

$ErrorActionPreference = "Stop"

$source = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

public static class DisplayConfigController
{
    private const int ERROR_SUCCESS = 0;
    private const int ERROR_INSUFFICIENT_BUFFER = 122;

    private const uint QDC_ONLY_ACTIVE_PATHS = 0x00000002;
    private const uint QDC_VIRTUAL_MODE_AWARE = 0x00000010;
    private const uint QDC_VIRTUAL_REFRESH_RATE_AWARE = 0x00000040;

    private const uint SDC_USE_SUPPLIED_DISPLAY_CONFIG = 0x00000020;
    private const uint SDC_APPLY = 0x00000080;
    private const uint SDC_SAVE_TO_DATABASE = 0x00000200;
    private const uint SDC_ALLOW_CHANGES = 0x00000400;
    private const uint SDC_VIRTUAL_MODE_AWARE = 0x00008000;
    private const uint SDC_VIRTUAL_REFRESH_RATE_AWARE = 0x00020000;

    private const uint DISPLAYCONFIG_PATH_ACTIVE = 0x00000001;
    private const int DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME = 1;
    private const int DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME = 2;

    public sealed class DisplayInfo
    {
        public string key { get; set; }
        public string friendlyName { get; set; }
        public string devicePath { get; set; }
        public string sourceName { get; set; }
        public string outputTechnology { get; set; }
        public int sourceId { get; set; }
        public int targetId { get; set; }
        public int positionX { get; set; }
        public int positionY { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public bool primary { get; set; }
        public bool active { get; set; }
    }

    public sealed class OperationResult
    {
        public string status { get; set; }
        public bool active { get; set; }
        public int activeDisplayCount { get; set; }
        public int matchedTargetCount { get; set; }
        public string snapshotPath { get; set; }
        public DisplayInfo[] displays { get; set; }
    }

    private sealed class DisplayState
    {
        public DISPLAYCONFIG_PATH_INFO[] Paths { get; set; }
        public DISPLAYCONFIG_MODE_INFO[] Modes { get; set; }
    }

    public static DisplayInfo[] ListDisplays()
    {
        DisplayState state = QueryActive();
        return BuildDisplayInfo(state).ToArray();
    }

    public static OperationResult SaveSnapshot(string snapshotPath)
    {
        if (String.IsNullOrWhiteSpace(snapshotPath))
        {
            throw new ArgumentException("SnapshotPath is required.");
        }

        DisplayState state = QueryActive();
        SaveSnapshotFromState(state, snapshotPath);

        return new OperationResult
        {
            status = "snapshot",
            active = true,
            activeDisplayCount = state.Paths.Length,
            matchedTargetCount = 0,
            snapshotPath = snapshotPath,
            displays = BuildDisplayInfo(state).ToArray()
        };
    }

    public static OperationResult IsActive(string[] targetKeys)
    {
        HashSet<string> targets = NormalizeTargetSet(targetKeys);
        DisplayInfo[] displays = ListDisplays();
        bool active = targets.Count > 0 && targets.All(target => displays.Any(display => String.Equals(display.key, target, StringComparison.OrdinalIgnoreCase)));

        return new OperationResult
        {
            status = active ? "active" : "inactive",
            active = active,
            activeDisplayCount = displays.Length,
            matchedTargetCount = targets.Count(target => displays.Any(display => String.Equals(display.key, target, StringComparison.OrdinalIgnoreCase))),
            displays = displays
        };
    }

    public static OperationResult Toggle(string[] targetKeys, string snapshotPath)
    {
        OperationResult current = IsActive(targetKeys);
        if (current.active)
        {
            return Disable(targetKeys, snapshotPath);
        }

        return Enable(targetKeys, snapshotPath);
    }

    public static OperationResult Disable(string[] targetKeys, string snapshotPath)
    {
        HashSet<string> targets = NormalizeTargetSet(targetKeys);
        if (targets.Count == 0)
        {
            throw new ArgumentException("At least one target key is required.");
        }

        if (String.IsNullOrWhiteSpace(snapshotPath))
        {
            throw new ArgumentException("SnapshotPath is required.");
        }

        DisplayState state = QueryActive();
        DISPLAYCONFIG_PATH_INFO[] remaining = state.Paths
            .Where(path => !targets.Contains(TargetKey(path.targetInfo.adapterId, path.targetInfo.id)))
            .ToArray();

        int matchedCount = state.Paths.Length - remaining.Length;
        if (matchedCount == 0)
        {
            DisplayInfo[] unchanged = BuildDisplayInfo(state).ToArray();
            return new OperationResult
            {
                status = "not-found",
                active = false,
                activeDisplayCount = unchanged.Length,
                matchedTargetCount = 0,
                snapshotPath = snapshotPath,
                displays = unchanged
            };
        }

        if (remaining.Length == 0)
        {
            throw new InvalidOperationException("Refusing to disable every active display.");
        }

        if (!File.Exists(snapshotPath))
        {
            SaveSnapshotFromState(state, snapshotPath);
        }

        Apply(remaining, PrepareModesForDisable(state, remaining));

        DisplayInfo[] displays = ListDisplays();
        return new OperationResult
        {
            status = "disabled",
            active = false,
            activeDisplayCount = displays.Length,
            matchedTargetCount = matchedCount,
            snapshotPath = snapshotPath,
            displays = displays
        };
    }

    public static OperationResult Enable(string[] targetKeys, string snapshotPath)
    {
        HashSet<string> targets = NormalizeTargetSet(targetKeys);
        if (targets.Count == 0)
        {
            throw new ArgumentException("At least one target key is required.");
        }

        if (String.IsNullOrWhiteSpace(snapshotPath))
        {
            throw new ArgumentException("SnapshotPath is required.");
        }

        if (!File.Exists(snapshotPath))
        {
            throw new FileNotFoundException("Snapshot file was not found.", snapshotPath);
        }

        DisplayState snapshot = ReadSnapshot(snapshotPath);
        DisplayState current = QueryActive();
        HashSet<string> snapshotKeys = new HashSet<string>(
            snapshot.Paths.Select(path => TargetKey(path.targetInfo.adapterId, path.targetInfo.id)),
            StringComparer.OrdinalIgnoreCase);
        HashSet<string> currentKeys = new HashSet<string>(
            current.Paths.Select(path => TargetKey(path.targetInfo.adapterId, path.targetInfo.id)),
            StringComparer.OrdinalIgnoreCase);

        if (currentKeys.Any(key => !snapshotKeys.Contains(key)))
        {
            throw new InvalidOperationException("Snapshot does not include all currently active displays.");
        }

        HashSet<string> selectedKeys = new HashSet<string>(
            targets.Where(target => snapshotKeys.Contains(target)),
            StringComparer.OrdinalIgnoreCase);

        if (selectedKeys.Count == 0)
        {
            DisplayInfo[] unchanged = BuildDisplayInfo(current).ToArray();
            return new OperationResult
            {
                status = "not-found",
                active = false,
                activeDisplayCount = unchanged.Length,
                matchedTargetCount = 0,
                snapshotPath = snapshotPath,
                displays = unchanged
            };
        }

        HashSet<string> finalKeys = new HashSet<string>(currentKeys, StringComparer.OrdinalIgnoreCase);
        foreach (string key in selectedKeys)
        {
            finalKeys.Add(key);
        }

        DISPLAYCONFIG_PATH_INFO[] enabledPaths = snapshot.Paths
            .Where(path => finalKeys.Contains(TargetKey(path.targetInfo.adapterId, path.targetInfo.id)))
            .ToArray();

        Apply(enabledPaths, PrepareModesForDisable(snapshot, enabledPaths));

        DisplayInfo[] displays = ListDisplays();
        bool active = targets.All(target => displays.Any(display => String.Equals(display.key, target, StringComparison.OrdinalIgnoreCase)));
        HashSet<string> activeKeys = new HashSet<string>(
            displays.Select(display => display.key),
            StringComparer.OrdinalIgnoreCase);
        if (snapshotKeys.All(key => activeKeys.Contains(key)))
        {
            TryDeleteSnapshot(snapshotPath);
        }

        return new OperationResult
        {
            status = active ? "enabled" : "partial",
            active = active,
            activeDisplayCount = displays.Length,
            matchedTargetCount = selectedKeys.Count,
            snapshotPath = snapshotPath,
            displays = displays
        };
    }

    public static OperationResult Restore(string snapshotPath)
    {
        if (String.IsNullOrWhiteSpace(snapshotPath))
        {
            throw new ArgumentException("SnapshotPath is required.");
        }

        if (!File.Exists(snapshotPath))
        {
            throw new FileNotFoundException("Snapshot file was not found.", snapshotPath);
        }

        DisplayState state = ReadSnapshot(snapshotPath);
        Apply(state.Paths, state.Modes);
        TryDeleteSnapshot(snapshotPath);

        DisplayInfo[] displays = ListDisplays();
        return new OperationResult
        {
            status = "restored",
            active = true,
            activeDisplayCount = displays.Length,
            matchedTargetCount = 0,
            snapshotPath = snapshotPath,
            displays = displays
        };
    }

    private static DisplayState QueryActive()
    {
        uint flags = QueryFlags();

        while (true)
        {
            uint pathCount;
            uint modeCount;
            int result = GetDisplayConfigBufferSizes(flags, out pathCount, out modeCount);
            ThrowIfWin32(result, "GetDisplayConfigBufferSizes");

            DISPLAYCONFIG_PATH_INFO[] paths = new DISPLAYCONFIG_PATH_INFO[pathCount];
            DISPLAYCONFIG_MODE_INFO[] modes = new DISPLAYCONFIG_MODE_INFO[modeCount];

            result = QueryDisplayConfig(flags, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
            if (result == ERROR_INSUFFICIENT_BUFFER)
            {
                continue;
            }

            ThrowIfWin32(result, "QueryDisplayConfig");
            Array.Resize(ref paths, (int)pathCount);
            Array.Resize(ref modes, (int)modeCount);

            return new DisplayState
            {
                Paths = paths,
                Modes = modes
            };
        }
    }

    private static IEnumerable<DisplayInfo> BuildDisplayInfo(DisplayState state)
    {
        foreach (DISPLAYCONFIG_PATH_INFO path in state.Paths)
        {
            DISPLAYCONFIG_SOURCE_MODE? sourceMode = FindSourceMode(state.Modes, path.sourceInfo.adapterId, path.sourceInfo.id);
            DISPLAYCONFIG_TARGET_DEVICE_NAME targetName = GetTargetName(path.targetInfo.adapterId, path.targetInfo.id);
            DISPLAYCONFIG_SOURCE_DEVICE_NAME sourceName = GetSourceName(path.sourceInfo.adapterId, path.sourceInfo.id);

            string friendlyName = String.IsNullOrWhiteSpace(targetName.monitorFriendlyDeviceName)
                ? "Display " + path.targetInfo.id.ToString()
                : targetName.monitorFriendlyDeviceName;

            yield return new DisplayInfo
            {
                key = TargetKey(path.targetInfo.adapterId, path.targetInfo.id),
                friendlyName = friendlyName,
                devicePath = targetName.monitorDevicePath,
                sourceName = sourceName.viewGdiDeviceName,
                outputTechnology = path.targetInfo.outputTechnology.ToString(),
                sourceId = unchecked((int)path.sourceInfo.id),
                targetId = unchecked((int)path.targetInfo.id),
                positionX = sourceMode.HasValue ? sourceMode.Value.position.x : 0,
                positionY = sourceMode.HasValue ? sourceMode.Value.position.y : 0,
                width = sourceMode.HasValue ? unchecked((int)sourceMode.Value.width) : 0,
                height = sourceMode.HasValue ? unchecked((int)sourceMode.Value.height) : 0,
                primary = sourceMode.HasValue && sourceMode.Value.position.x == 0 && sourceMode.Value.position.y == 0,
                active = (path.flags & DISPLAYCONFIG_PATH_ACTIVE) == DISPLAYCONFIG_PATH_ACTIVE
            };
        }
    }

    private static DISPLAYCONFIG_SOURCE_MODE? FindSourceMode(DISPLAYCONFIG_MODE_INFO[] modes, LUID adapterId, uint sourceId)
    {
        foreach (DISPLAYCONFIG_MODE_INFO mode in modes)
        {
            if (mode.infoType == DISPLAYCONFIG_MODE_INFO_TYPE.SOURCE &&
                mode.id == sourceId &&
                SameLuid(mode.adapterId, adapterId))
            {
                return mode.modeInfo.sourceMode;
            }
        }

        return null;
    }

    private static DISPLAYCONFIG_MODE_INFO[] PrepareModesForDisable(DisplayState state, DISPLAYCONFIG_PATH_INFO[] remaining)
    {
        DISPLAYCONFIG_MODE_INFO[] modes = state.Modes.ToArray();
        if (remaining.Length == 0 || HasPrimarySourceMode(modes, remaining))
        {
            return modes;
        }

        DISPLAYCONFIG_PATH_INFO? newPrimaryPath = ChooseNewPrimaryPath(modes, remaining);
        if (!newPrimaryPath.HasValue)
        {
            return modes;
        }

        DISPLAYCONFIG_SOURCE_MODE? newPrimarySourceMode = FindSourceMode(
            modes,
            newPrimaryPath.Value.sourceInfo.adapterId,
            newPrimaryPath.Value.sourceInfo.id);

        if (!newPrimarySourceMode.HasValue)
        {
            return modes;
        }

        int offsetX = newPrimarySourceMode.Value.position.x;
        int offsetY = newPrimarySourceMode.Value.position.y;
        if (offsetX == 0 && offsetY == 0)
        {
            return modes;
        }

        HashSet<string> remainingSources = new HashSet<string>(
            remaining.Select(path => SourceKey(path.sourceInfo.adapterId, path.sourceInfo.id)),
            StringComparer.OrdinalIgnoreCase);

        for (int index = 0; index < modes.Length; index++)
        {
            DISPLAYCONFIG_MODE_INFO mode = modes[index];
            if (mode.infoType != DISPLAYCONFIG_MODE_INFO_TYPE.SOURCE ||
                !remainingSources.Contains(SourceKey(mode.adapterId, mode.id)))
            {
                continue;
            }

            DISPLAYCONFIG_SOURCE_MODE sourceMode = mode.modeInfo.sourceMode;
            sourceMode.position.x -= offsetX;
            sourceMode.position.y -= offsetY;
            mode.modeInfo.sourceMode = sourceMode;
            modes[index] = mode;
        }

        return modes;
    }

    private static bool HasPrimarySourceMode(DISPLAYCONFIG_MODE_INFO[] modes, DISPLAYCONFIG_PATH_INFO[] paths)
    {
        foreach (DISPLAYCONFIG_PATH_INFO path in paths)
        {
            DISPLAYCONFIG_SOURCE_MODE? sourceMode = FindSourceMode(modes, path.sourceInfo.adapterId, path.sourceInfo.id);
            if (sourceMode.HasValue && sourceMode.Value.position.x == 0 && sourceMode.Value.position.y == 0)
            {
                return true;
            }
        }

        return false;
    }

    private static DISPLAYCONFIG_PATH_INFO? ChooseNewPrimaryPath(DISPLAYCONFIG_MODE_INFO[] modes, DISPLAYCONFIG_PATH_INFO[] paths)
    {
        DISPLAYCONFIG_PATH_INFO? bestPath = null;
        long bestScore = long.MaxValue;

        foreach (DISPLAYCONFIG_PATH_INFO path in paths)
        {
            DISPLAYCONFIG_SOURCE_MODE? sourceMode = FindSourceMode(modes, path.sourceInfo.adapterId, path.sourceInfo.id);
            if (!sourceMode.HasValue)
            {
                continue;
            }

            long score = Math.Abs((long)sourceMode.Value.position.x) + Math.Abs((long)sourceMode.Value.position.y);
            if (!bestPath.HasValue || score < bestScore)
            {
                bestPath = path;
                bestScore = score;
            }
        }

        return bestPath;
    }

    private static void SaveSnapshotFromState(DisplayState state, string snapshotPath)
    {
        string directory = Path.GetDirectoryName(snapshotPath);
        if (!String.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        using (FileStream file = File.Open(snapshotPath, FileMode.Create, FileAccess.Write, FileShare.None))
        using (BinaryWriter writer = new BinaryWriter(file))
        {
            writer.Write("UDMT1");
            WriteStructArray(writer, state.Paths);
            WriteStructArray(writer, state.Modes);
        }
    }

    private static DisplayState ReadSnapshot(string snapshotPath)
    {
        using (FileStream file = File.Open(snapshotPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (BinaryReader reader = new BinaryReader(file))
        {
            string marker = reader.ReadString();
            if (!String.Equals(marker, "UDMT1", StringComparison.Ordinal))
            {
                throw new InvalidDataException("Snapshot file format is not recognized.");
            }

            return new DisplayState
            {
                Paths = ReadStructArray<DISPLAYCONFIG_PATH_INFO>(reader),
                Modes = ReadStructArray<DISPLAYCONFIG_MODE_INFO>(reader)
            };
        }
    }

    private static void TryDeleteSnapshot(string snapshotPath)
    {
        try
        {
            File.Delete(snapshotPath);
        }
        catch
        {
        }
    }

    private static void WriteStructArray<T>(BinaryWriter writer, T[] items) where T : struct
    {
        writer.Write(items.Length);
        int size = Marshal.SizeOf(typeof(T));
        writer.Write(size);

        foreach (T item in items)
        {
            writer.Write(StructToBytes(item, size));
        }
    }

    private static T[] ReadStructArray<T>(BinaryReader reader) where T : struct
    {
        int count = reader.ReadInt32();
        int storedSize = reader.ReadInt32();
        int expectedSize = Marshal.SizeOf(typeof(T));
        if (storedSize != expectedSize)
        {
            throw new InvalidDataException("Snapshot struct size mismatch.");
        }

        T[] items = new T[count];
        for (int i = 0; i < count; i++)
        {
            items[i] = BytesToStruct<T>(reader.ReadBytes(storedSize));
        }

        return items;
    }

    private static byte[] StructToBytes<T>(T item, int size) where T : struct
    {
        byte[] bytes = new byte[size];
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(item, pointer, false);
            Marshal.Copy(pointer, bytes, 0, size);
            return bytes;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static T BytesToStruct<T>(byte[] bytes) where T : struct
    {
        int size = Marshal.SizeOf(typeof(T));
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.Copy(bytes, 0, pointer, size);
            return (T)Marshal.PtrToStructure(pointer, typeof(T));
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    private static void Apply(DISPLAYCONFIG_PATH_INFO[] paths, DISPLAYCONFIG_MODE_INFO[] modes)
    {
        int result = SetDisplayConfig(
            (uint)paths.Length,
            paths,
            (uint)modes.Length,
            modes,
            SetFlags());

        ThrowIfWin32(result, "SetDisplayConfig");
    }

    private static uint QueryFlags()
    {
        uint flags = QDC_ONLY_ACTIVE_PATHS | QDC_VIRTUAL_MODE_AWARE;
        if (Environment.OSVersion.Version.Build >= 22000)
        {
            flags |= QDC_VIRTUAL_REFRESH_RATE_AWARE;
        }

        return flags;
    }

    private static uint SetFlags()
    {
        uint flags = SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_APPLY | SDC_SAVE_TO_DATABASE | SDC_ALLOW_CHANGES | SDC_VIRTUAL_MODE_AWARE;
        if (Environment.OSVersion.Version.Build >= 22000)
        {
            flags |= SDC_VIRTUAL_REFRESH_RATE_AWARE;
        }

        return flags;
    }

    private static HashSet<string> NormalizeTargetSet(string[] targetKeys)
    {
        return new HashSet<string>(
            (targetKeys ?? new string[0])
                .Where(value => !String.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim()),
            StringComparer.OrdinalIgnoreCase);
    }

    private static string TargetKey(LUID adapterId, uint targetId)
    {
        return String.Format("{0:X8}:{1:X8}:{2}", unchecked((uint)adapterId.HighPart), adapterId.LowPart, targetId);
    }

    private static string SourceKey(LUID adapterId, uint sourceId)
    {
        return String.Format("{0:X8}:{1:X8}:{2}", unchecked((uint)adapterId.HighPart), adapterId.LowPart, sourceId);
    }

    private static bool SameLuid(LUID left, LUID right)
    {
        return left.LowPart == right.LowPart && left.HighPart == right.HighPart;
    }

    private static DISPLAYCONFIG_TARGET_DEVICE_NAME GetTargetName(LUID adapterId, uint targetId)
    {
        DISPLAYCONFIG_TARGET_DEVICE_NAME targetName = new DISPLAYCONFIG_TARGET_DEVICE_NAME();
        targetName.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
        targetName.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_TARGET_DEVICE_NAME));
        targetName.header.adapterId = adapterId;
        targetName.header.id = targetId;

        int result = DisplayConfigGetDeviceInfo(ref targetName);
        if (result != ERROR_SUCCESS)
        {
            targetName.monitorFriendlyDeviceName = "";
            targetName.monitorDevicePath = "";
        }

        return targetName;
    }

    private static DISPLAYCONFIG_SOURCE_DEVICE_NAME GetSourceName(LUID adapterId, uint sourceId)
    {
        DISPLAYCONFIG_SOURCE_DEVICE_NAME sourceName = new DISPLAYCONFIG_SOURCE_DEVICE_NAME();
        sourceName.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        sourceName.header.size = (uint)Marshal.SizeOf(typeof(DISPLAYCONFIG_SOURCE_DEVICE_NAME));
        sourceName.header.adapterId = adapterId;
        sourceName.header.id = sourceId;

        int result = DisplayConfigGetDeviceInfo(ref sourceName);
        if (result != ERROR_SUCCESS)
        {
            sourceName.viewGdiDeviceName = "";
        }

        return sourceName;
    }

    private static void ThrowIfWin32(int result, string operation)
    {
        if (result == ERROR_SUCCESS)
        {
            return;
        }

        throw new InvalidOperationException(operation + " failed with Win32 error " + result + ".");
    }

    [DllImport("user32.dll")]
    private static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);

    [DllImport("user32.dll")]
    private static extern int QueryDisplayConfig(
        uint flags,
        ref uint numPathArrayElements,
        [Out] DISPLAYCONFIG_PATH_INFO[] pathArray,
        ref uint numModeInfoArrayElements,
        [Out] DISPLAYCONFIG_MODE_INFO[] modeInfoArray,
        IntPtr currentTopologyId);

    [DllImport("user32.dll")]
    private static extern int SetDisplayConfig(
        uint numPathArrayElements,
        [In] DISPLAYCONFIG_PATH_INFO[] pathArray,
        uint numModeInfoArrayElements,
        [In] DISPLAYCONFIG_MODE_INFO[] modeInfoArray,
        uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_TARGET_DEVICE_NAME requestPacket);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_SOURCE_DEVICE_NAME requestPacket);

    [StructLayout(LayoutKind.Sequential)]
    public struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_PATH_INFO
    {
        public DISPLAYCONFIG_PATH_SOURCE_INFO sourceInfo;
        public DISPLAYCONFIG_PATH_TARGET_INFO targetInfo;
        public uint flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_PATH_SOURCE_INFO
    {
        public LUID adapterId;
        public uint id;
        public uint modeInfoIdx;
        public uint statusFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_PATH_TARGET_INFO
    {
        public LUID adapterId;
        public uint id;
        public uint modeInfoIdx;
        public DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY outputTechnology;
        public DISPLAYCONFIG_ROTATION rotation;
        public DISPLAYCONFIG_SCALING scaling;
        public DISPLAYCONFIG_RATIONAL refreshRate;
        public DISPLAYCONFIG_SCANLINE_ORDERING scanLineOrdering;
        [MarshalAs(UnmanagedType.Bool)]
        public bool targetAvailable;
        public uint statusFlags;
    }

    public enum DISPLAYCONFIG_MODE_INFO_TYPE : uint
    {
        SOURCE = 1,
        TARGET = 2,
        DESKTOP_IMAGE = 3
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_MODE_INFO
    {
        public DISPLAYCONFIG_MODE_INFO_TYPE infoType;
        public uint id;
        public LUID adapterId;
        public DISPLAYCONFIG_MODE_INFO_UNION modeInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct DISPLAYCONFIG_MODE_INFO_UNION
    {
        [FieldOffset(0)]
        public DISPLAYCONFIG_TARGET_MODE targetMode;
        [FieldOffset(0)]
        public DISPLAYCONFIG_SOURCE_MODE sourceMode;
        [FieldOffset(0)]
        public DISPLAYCONFIG_DESKTOP_IMAGE_INFO desktopImageInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_TARGET_MODE
    {
        public DISPLAYCONFIG_VIDEO_SIGNAL_INFO targetVideoSignalInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_SOURCE_MODE
    {
        public uint width;
        public uint height;
        public DISPLAYCONFIG_PIXELFORMAT pixelFormat;
        public POINTL position;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_DESKTOP_IMAGE_INFO
    {
        public POINTL PathSourceSize;
        public RECTL DesktopImageRegion;
        public RECTL DesktopImageClipRegion;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_VIDEO_SIGNAL_INFO
    {
        public ulong pixelRate;
        public DISPLAYCONFIG_RATIONAL hSyncFreq;
        public DISPLAYCONFIG_RATIONAL vSyncFreq;
        public DISPLAYCONFIG_2DREGION activeSize;
        public DISPLAYCONFIG_2DREGION totalSize;
        public uint videoStandard;
        public DISPLAYCONFIG_SCANLINE_ORDERING scanLineOrdering;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_RATIONAL
    {
        public uint Numerator;
        public uint Denominator;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct DISPLAYCONFIG_2DREGION
    {
        public uint cx;
        public uint cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINTL
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECTL
    {
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    public enum DISPLAYCONFIG_PIXELFORMAT : uint
    {
        PIXELFORMAT_8BPP = 1,
        PIXELFORMAT_16BPP = 2,
        PIXELFORMAT_24BPP = 3,
        PIXELFORMAT_32BPP = 4,
        PIXELFORMAT_NONGDI = 5
    }

    public enum DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY : uint
    {
        OTHER = 4294967295,
        HD15 = 0,
        SVIDEO = 1,
        COMPOSITE_VIDEO = 2,
        COMPONENT_VIDEO = 3,
        DVI = 4,
        HDMI = 5,
        LVDS = 6,
        D_JPN = 8,
        SDI = 9,
        DISPLAYPORT_EXTERNAL = 10,
        DISPLAYPORT_EMBEDDED = 11,
        UDI_EXTERNAL = 12,
        UDI_EMBEDDED = 13,
        SDTVDONGLE = 14,
        MIRACAST = 15,
        INDIRECT_WIRED = 16,
        INTERNAL = 2147483648,
        FORCE_UINT32 = 4294967295
    }

    public enum DISPLAYCONFIG_ROTATION : uint
    {
        IDENTITY = 1,
        ROTATE90 = 2,
        ROTATE180 = 3,
        ROTATE270 = 4,
        FORCE_UINT32 = 4294967295
    }

    public enum DISPLAYCONFIG_SCALING : uint
    {
        IDENTITY = 1,
        CENTERED = 2,
        STRETCHED = 3,
        ASPECTRATIOCENTEREDMAX = 4,
        CUSTOM = 5,
        PREFERRED = 128,
        FORCE_UINT32 = 4294967295
    }

    public enum DISPLAYCONFIG_SCANLINE_ORDERING : uint
    {
        UNSPECIFIED = 0,
        PROGRESSIVE = 1,
        INTERLACED = 2,
        INTERLACED_UPPERFIELDFIRST = 2,
        INTERLACED_LOWERFIELDFIRST = 3,
        FORCE_UINT32 = 4294967295
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAYCONFIG_DEVICE_INFO_HEADER
    {
        public int type;
        public uint size;
        public LUID adapterId;
        public uint id;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAYCONFIG_SOURCE_DEVICE_NAME
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string viewGdiDeviceName;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAYCONFIG_TARGET_DEVICE_NAME
    {
        public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
        public uint flags;
        public DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY outputTechnology;
        public ushort edidManufactureId;
        public ushort edidProductCodeId;
        public uint connectorInstance;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string monitorFriendlyDeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string monitorDevicePath;
    }
}
"@

Add-Type -TypeDefinition $source

function Split-TargetKeys {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return @()
    }

    return @(
        $Value -split "[,\r\n]+" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
}

function Write-Result {
    param([object]$Value)

    if ($Pretty) {
        $Value | ConvertTo-Json -Depth 8
    } else {
        $Value | ConvertTo-Json -Depth 8 -Compress
    }
}

$targets = Split-TargetKeys -Value $TargetKeys

switch ($Action) {
    "list" {
        $displays = [DisplayConfigController]::ListDisplays()
        Write-Result ([pscustomobject]@{
            status = "listed"
            active = $true
            activeDisplayCount = $displays.Count
            displays = $displays
        })
    }
    "snapshot" {
        Write-Result ([DisplayConfigController]::SaveSnapshot($SnapshotPath))
    }
    "disable" {
        Write-Result ([DisplayConfigController]::Disable($targets, $SnapshotPath))
    }
    "enable" {
        Write-Result ([DisplayConfigController]::Enable($targets, $SnapshotPath))
    }
    "restore" {
        Write-Result ([DisplayConfigController]::Restore($SnapshotPath))
    }
    "is-active" {
        Write-Result ([DisplayConfigController]::IsActive($targets))
    }
    "toggle" {
        Write-Result ([DisplayConfigController]::Toggle($targets, $SnapshotPath))
    }
}
