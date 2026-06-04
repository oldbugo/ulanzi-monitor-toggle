import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PROVIDER_LABELS, snapshotLevel } from "./model.js";

export const PROVIDER_ADAPTERS = {
  codex: {
    command: "codex",
    versionArgs: ["--version"],
    label: PROVIDER_LABELS.codex,
    statusCommands: []
  },
  claude: {
    command: "claude",
    versionArgs: ["--version"],
    label: PROVIDER_LABELS.claude,
    statusCommands: []
  }
};

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE_OAUTH_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export function runCommand(command, args = [], timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resetAtFromWindow(windowData, now = new Date()) {
  const resetAtSeconds = Number(windowData?.reset_at);
  if (Number.isFinite(resetAtSeconds) && resetAtSeconds > 0) {
    return new Date(resetAtSeconds * 1000).toISOString();
  }

  const resetAfterSeconds = Number(windowData?.reset_after_seconds);
  if (Number.isFinite(resetAfterSeconds) && resetAfterSeconds > 0) {
    return new Date(now.getTime() + resetAfterSeconds * 1000).toISOString();
  }

  const resetsAt = windowData?.resets_at;
  if (resetsAt) {
    const date = new Date(resetsAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function remainingPercentFromUsedPercent(usedPercent) {
  return Math.max(0, 100 - usedPercent);
}

function liveUsageSnapshot(settings, fields, now = new Date()) {
  const usedPercent = percent(fields.usedPercent);
  if (usedPercent === null) {
    return null;
  }

  const remainingPercent = remainingPercentFromUsedPercent(usedPercent);
  const snapshot = {
    provider: settings.provider,
    window: settings.window,
    source: "auto_status",
    status: "live",
    remainingPercent,
    usedPercent,
    resetAt: fields.resetAt,
    fetchedAt: now.toISOString(),
    cliVersion: fields.cliVersion || null,
    planType: fields.planType || null,
    sourceDetail: fields.sourceDetail,
    message: typeof fields.messageFromPercents === "function"
      ? fields.messageFromPercents({ remainingPercent, usedPercent })
      : fields.message
  };

  return {
    ...snapshot,
    level: snapshotLevel(snapshot, settings)
  };
}

export function normalizeCodexUsageSnapshot(settings, data, now = new Date(), cliVersion = null) {
  const rateLimit = data?.rate_limit || {};
  const selectedWindow = settings.window === "weekly"
    ? rateLimit.secondary_window
    : rateLimit.primary_window;
  const resetAt = resetAtFromWindow(selectedWindow, now);
  const planType = typeof data?.plan_type === "string" ? data.plan_type : null;
  const allowed = rateLimit.allowed !== false;
  const limitReached = Boolean(rateLimit.limit_reached);
  const credits = data?.credits || {};
  const creditsText = credits.has_credits
    ? ` Extra credits: ${credits.unlimited ? "unlimited" : credits.balance ?? "available"}.`
    : "";

  return liveUsageSnapshot(settings, {
    usedPercent: selectedWindow?.used_percent,
    resetAt,
    cliVersion,
    planType,
    sourceDetail: "codex_chatgpt_auth",
    messageFromPercents: ({ remainingPercent, usedPercent }) => `Codex allowance from ChatGPT auth${planType ? ` (${planType})` : ""}: ${remainingPercent}% remaining; ${usedPercent}% used.${allowed ? "" : " Usage is not currently allowed."}${limitReached ? " Limit reached." : ""}${creditsText}`
  }, now);
}

export function normalizeClaudeOauthUsageSnapshot(settings, data, now = new Date(), cliVersion = null) {
  const selectedWindow = settings.window === "weekly"
    ? data?.seven_day
    : data?.five_hour;
  const resetAt = resetAtFromWindow(selectedWindow, now);
  const planType = typeof data?.plan === "string" ? data.plan : null;

  return liveUsageSnapshot(settings, {
    usedPercent: selectedWindow?.utilization,
    resetAt,
    cliVersion,
    planType,
    sourceDetail: "claude_oauth",
    messageFromPercents: ({ remainingPercent, usedPercent }) => `Claude allowance from local OAuth${planType ? ` (${planType})` : ""}: ${remainingPercent}% remaining; ${usedPercent}% used.`
  }, now);
}

function codexAuthPath() {
  return path.join(os.homedir(), ".codex", "auth.json");
}

function claudeCredentialCandidates() {
  const candidates = [];
  if (process.env.CLAUDE_CONFIG_DIR) {
    candidates.push(path.join(process.env.CLAUDE_CONFIG_DIR, ".credentials.json"));
  }
  candidates.push(path.join(os.homedir(), ".claude", ".credentials.json"));
  return candidates;
}

function claudeOauthTokenSource() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return {
      token: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      source: "CLAUDE_CODE_OAUTH_TOKEN"
    };
  }

  const file = claudeCredentialCandidates().find((candidate) => fs.existsSync(candidate));
  if (!file) {
    return null;
  }

  const credentials = readJsonFile(file);
  const token = credentials?.claudeAiOauth?.accessToken || credentials?.accessToken;
  if (!token) {
    throw new Error(`${file} exists but does not contain a Claude OAuth access token.`);
  }

  return {
    token,
    source: file
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON status ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(data?.error?.message || data?.detail || `${url} returned status ${response.status}`);
  }

  return data;
}

async function codexChatGptUsageSnapshot(settings, now = new Date()) {
  const file = codexAuthPath();
  if (!fs.existsSync(file)) {
    return null;
  }

  const auth = readJsonFile(file);
  const accessToken = auth?.tokens?.access_token;
  if (!accessToken) {
    return null;
  }

  const data = await fetchJson(CODEX_USAGE_URL, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "oai-language": "en-US"
    }
  });
  const snapshot = normalizeCodexUsageSnapshot(settings, data, now, null);
  if (!snapshot) {
    throw new Error("ChatGPT usage response did not include the selected allowance window.");
  }

  return snapshot;
}

async function claudeOauthUsageSnapshot(settings, now = new Date()) {
  const tokenSource = claudeOauthTokenSource();
  if (!tokenSource) {
    return null;
  }

  const data = await fetchJson(CLAUDE_OAUTH_USAGE_URL, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${tokenSource.token}`,
      "anthropic-beta": "oauth-2025-04-20"
    }
  });
  const snapshot = normalizeClaudeOauthUsageSnapshot(settings, data, now, null);
  if (!snapshot) {
    throw new Error("Claude OAuth usage response did not include the selected allowance window.");
  }

  return snapshot;
}

async function detectProviderCli(adapter) {
  const result = await runCommand(adapter.command, adapter.versionArgs);
  if (result.code !== 0) {
    throw new Error(result.stderr || `${adapter.command} ${adapter.versionArgs.join(" ")} exited with code ${result.code}`);
  }

  return result.stdout || result.stderr || adapter.command;
}

function unsupportedSnapshot(settings, adapter, now, cliVersion, message) {
  return {
    provider: settings.provider,
    window: settings.window,
    source: "auto_status",
    status: "unsupported",
    level: "unknown",
    remainingPercent: null,
    resetAt: null,
    fetchedAt: now.toISOString(),
    cliVersion,
    message
  };
}

export async function resolveAutoStatusSnapshot(settings, now = new Date()) {
  const adapter = PROVIDER_ADAPTERS[settings.provider];
  if (!adapter) {
    return unsupportedSnapshot(
      settings,
      { label: settings.provider },
      now,
      null,
      "Provider adapter is not available."
    );
  }

  let cliVersion = null;
  try {
    cliVersion = await detectProviderCli(adapter);
  } catch (error) {
    return unsupportedSnapshot(
      settings,
      adapter,
      now,
      null,
      `${adapter.label} CLI status is unavailable: ${error.message}`
    );
  }

  let liveSnapshotResult = null;
  try {
    liveSnapshotResult = settings.provider === "codex"
      ? await codexChatGptUsageSnapshot(settings, now)
      : await claudeOauthUsageSnapshot(settings, now);
  } catch (error) {
    throw new Error(`${adapter.label} live allowance refresh failed: ${error.message}`);
  }

  if (liveSnapshotResult) {
    return {
      ...liveSnapshotResult,
      cliVersion
    };
  }

  const desktopContext = settings.provider === "claude"
    ? " Claude Desktop's Windows app profile is app-container encrypted; run Claude Code /login to create .credentials.json, or set CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, then restart Ulanzi Studio."
    : "";
  return unsupportedSnapshot(
    settings,
    adapter,
    now,
    cliVersion,
    `${adapter.label} is installed, but no readable local allowance source is available.${desktopContext} Use manual mode.`
  );
}
