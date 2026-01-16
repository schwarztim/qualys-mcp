#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance, AxiosError } from "axios";
import { parseStringPromise } from "xml2js";
import http from "http";
import https from "https";

// Environment variables for configuration
const QUALYS_API_URL = process.env.QUALYS_API_URL || "https://qualysapi.qualys.com";
const QUALYS_USERNAME = process.env.QUALYS_USERNAME || "";
const QUALYS_PASSWORD = process.env.QUALYS_PASSWORD || "";

// Rate limiting configuration
const RATE_LIMIT_DELAY_MS = 1000; // 1 second between requests
let lastRequestTime = 0;

// Singleton HTTP client with connection pooling
let apiClient: AxiosInstance | null = null;
let cachedAuthHeader: string | null = null;

// HTTP agents for connection pooling (reuse connections)
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // Keep connections alive for 30 seconds
  maxSockets: 10, // Allow up to 10 concurrent connections
  maxFreeSockets: 5, // Keep up to 5 idle connections
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
});

// Create axios instance with authentication and connection pooling (singleton pattern)
function getApiClient(): AxiosInstance {
  // Return cached client if already created
  if (apiClient) {
    return apiClient;
  }

  // Cache the auth header to avoid re-computing Base64 encoding on every call
  if (!cachedAuthHeader && QUALYS_USERNAME && QUALYS_PASSWORD) {
    cachedAuthHeader = `Basic ${Buffer.from(`${QUALYS_USERNAME}:${QUALYS_PASSWORD}`).toString("base64")}`;
  }

  // Create client with HTTP connection pooling enabled
  apiClient = axios.create({
    baseURL: QUALYS_API_URL,
    headers: {
      "Authorization": cachedAuthHeader || "",
      "X-Requested-With": "qualys-mcp",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 120000, // 2 minutes timeout for long-running requests
    // Enable HTTP keep-alive for connection pooling (significant performance improvement)
    httpAgent,
    httpsAgent,
  });

  return apiClient;
}

// Rate limiting helper
async function rateLimitedRequest<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();
  return fn();
}

// Parse XML response to JSON
async function parseXmlResponse(xml: string): Promise<unknown> {
  try {
    return await parseStringPromise(xml, {
      explicitArray: false,
      ignoreAttrs: false,
      mergeAttrs: true,
    });
  } catch (error) {
    return { raw: xml };
  }
}

// Error handler
function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      return `API Error: ${error.response.status} - ${error.response.statusText}. ${JSON.stringify(error.response.data)}`;
    }
    if (error.code === "ECONNREFUSED") {
      return "Connection refused. Check your QUALYS_API_URL configuration.";
    }
    return `Request Error: ${error.message}`;
  }
  return `Unknown Error: ${String(error)}`;
}

// Build form data from object
function buildFormData(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params)
    .filter(([_, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return entries.join("&");
}

// Tool definitions
const tools: Tool[] = [
  {
    name: "qualys_list_hosts",
    description: "List scanned hosts in your Qualys account. Returns host information including IPs, hostnames, OS, and scan dates.",
    inputSchema: {
      type: "object",
      properties: {
        ips: {
          type: "string",
          description: "Filter by IP addresses (comma-separated or ranges like 10.0.0.1-10.0.0.255)",
        },
        ag_ids: {
          type: "string",
          description: "Filter by asset group IDs (comma-separated)",
        },
        ag_titles: {
          type: "string",
          description: "Filter by asset group titles (comma-separated)",
        },
        truncation_limit: {
          type: "number",
          description: "Maximum number of hosts to return (default: 100, max: 10000)",
          default: 100,
        },
        details: {
          type: "string",
          enum: ["Basic", "Basic/AGs", "All", "All/AGs", "None"],
          description: "Level of detail to return (default: Basic)",
          default: "Basic",
        },
      },
    },
  },
  {
    name: "qualys_get_host_detections",
    description: "Get vulnerability detections for hosts. Returns detailed vulnerability information including QIDs, severity, and status.",
    inputSchema: {
      type: "object",
      properties: {
        ips: {
          type: "string",
          description: "Filter by IP addresses (comma-separated or ranges)",
        },
        ids: {
          type: "string",
          description: "Filter by host IDs (comma-separated)",
        },
        ag_ids: {
          type: "string",
          description: "Filter by asset group IDs (comma-separated)",
        },
        status: {
          type: "string",
          enum: ["New", "Active", "Fixed", "Re-Opened"],
          description: "Filter by detection status",
        },
        severities: {
          type: "string",
          description: "Filter by severity levels (comma-separated: 1-5)",
        },
        qids: {
          type: "string",
          description: "Filter by specific QIDs (comma-separated)",
        },
        truncation_limit: {
          type: "number",
          description: "Maximum number of records (default: 100)",
          default: 100,
        },
        show_igs: {
          type: "boolean",
          description: "Include information gathered results",
          default: false,
        },
        include_vuln_type: {
          type: "string",
          enum: ["Confirmed", "Potential"],
          description: "Filter by vulnerability type",
        },
        arf_filter_keys: {
          type: "string",
          description: "Advanced Remediation Filters (2024+): non-running-kernel, non-running-service, config-not-exploitable (comma-separated)",
        },
        show_epss: {
          type: "boolean",
          description: "Include EPSS (Exploit Prediction Scoring System) scores (2024+ feature)",
          default: false,
        },
      },
    },
  },
  {
    name: "qualys_launch_scan",
    description: "Launch a vulnerability scan on specified targets. Returns scan reference ID for tracking.",
    inputSchema: {
      type: "object",
      properties: {
        scan_title: {
          type: "string",
          description: "Title for the scan (required)",
        },
        ip: {
          type: "string",
          description: "IP addresses to scan (comma-separated or ranges)",
        },
        asset_groups: {
          type: "string",
          description: "Asset group names to scan (comma-separated)",
        },
        asset_group_ids: {
          type: "string",
          description: "Asset group IDs to scan (comma-separated)",
        },
        option_title: {
          type: "string",
          description: "Option profile title to use for the scan",
        },
        option_id: {
          type: "number",
          description: "Option profile ID to use for the scan",
        },
        iscanner_name: {
          type: "string",
          description: "Scanner appliance name(s) to use (comma-separated)",
        },
        priority: {
          type: "number",
          description: "Scan priority (0-9, 0 is default/lowest)",
          default: 0,
        },
      },
      required: ["scan_title"],
    },
  },
  {
    name: "qualys_list_scans",
    description: "List vulnerability scans in your account. Returns scan details including status, targets, and results.",
    inputSchema: {
      type: "object",
      properties: {
        scan_ref: {
          type: "string",
          description: "Filter by specific scan reference ID",
        },
        state: {
          type: "string",
          enum: ["Running", "Paused", "Canceled", "Finished", "Error", "Queued"],
          description: "Filter by scan state",
        },
        type: {
          type: "string",
          enum: ["On-Demand", "Scheduled", "API"],
          description: "Filter by scan type",
        },
        launched_after_datetime: {
          type: "string",
          description: "Filter scans launched after this date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)",
        },
        launched_before_datetime: {
          type: "string",
          description: "Filter scans launched before this date",
        },
      },
    },
  },
  {
    name: "qualys_get_scan_results",
    description: "Get detailed results for a specific scan by reference ID.",
    inputSchema: {
      type: "object",
      properties: {
        scan_ref: {
          type: "string",
          description: "Scan reference ID (required)",
        },
        output_format: {
          type: "string",
          enum: ["xml", "csv", "json_extended"],
          description: "Output format (default: xml)",
          default: "xml",
        },
      },
      required: ["scan_ref"],
    },
  },
  {
    name: "qualys_cancel_scan",
    description: "Cancel a running or queued scan.",
    inputSchema: {
      type: "object",
      properties: {
        scan_ref: {
          type: "string",
          description: "Scan reference ID to cancel (required)",
        },
      },
      required: ["scan_ref"],
    },
  },
  {
    name: "qualys_pause_scan",
    description: "Pause a running scan.",
    inputSchema: {
      type: "object",
      properties: {
        scan_ref: {
          type: "string",
          description: "Scan reference ID to pause (required)",
        },
      },
      required: ["scan_ref"],
    },
  },
  {
    name: "qualys_resume_scan",
    description: "Resume a paused scan.",
    inputSchema: {
      type: "object",
      properties: {
        scan_ref: {
          type: "string",
          description: "Scan reference ID to resume (required)",
        },
      },
      required: ["scan_ref"],
    },
  },
  {
    name: "qualys_list_reports",
    description: "List available reports in your Qualys account.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Filter by specific report ID",
        },
        state: {
          type: "string",
          enum: ["Running", "Finished", "Submitted", "Canceled", "Errors"],
          description: "Filter by report state",
        },
      },
    },
  },
  {
    name: "qualys_launch_report",
    description: "Launch a new vulnerability report.",
    inputSchema: {
      type: "object",
      properties: {
        template_id: {
          type: "number",
          description: "Report template ID (required)",
        },
        report_title: {
          type: "string",
          description: "Title for the report",
        },
        output_format: {
          type: "string",
          enum: ["pdf", "html", "mht", "xml", "csv", "docx"],
          description: "Report output format (default: pdf)",
          default: "pdf",
        },
        ips: {
          type: "string",
          description: "IP addresses to include (comma-separated or ranges)",
        },
        asset_group_ids: {
          type: "string",
          description: "Asset group IDs to include (comma-separated)",
        },
      },
      required: ["template_id"],
    },
  },
  {
    name: "qualys_download_report",
    description: "Download a finished report by ID. Returns the report content or download URL.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Report ID to download (required)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "qualys_list_asset_groups",
    description: "List asset groups in your Qualys account.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "string",
          description: "Filter by asset group IDs (comma-separated)",
        },
        title: {
          type: "string",
          description: "Filter by title (partial match supported)",
        },
        truncation_limit: {
          type: "number",
          description: "Maximum number of results (default: 100)",
          default: 100,
        },
      },
    },
  },
  {
    name: "qualys_get_knowledgebase",
    description: "Search the Qualys KnowledgeBase for vulnerability information by QID or CVE.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "string",
          description: "Filter by QIDs (comma-separated or ranges like 1-100)",
        },
        id_min: {
          type: "string",
          description: "Minimum QID in range",
        },
        id_max: {
          type: "string",
          description: "Maximum QID in range",
        },
        details: {
          type: "string",
          enum: ["Basic", "All", "None"],
          description: "Level of detail (default: Basic)",
          default: "Basic",
        },
        last_modified_after: {
          type: "string",
          description: "Filter by last modified date (YYYY-MM-DD)",
        },
        last_modified_before: {
          type: "string",
          description: "Filter by last modified before date (YYYY-MM-DD)",
        },
        published_after: {
          type: "string",
          description: "Filter by publish date (YYYY-MM-DD)",
        },
        published_before: {
          type: "string",
          description: "Filter by publish before date (YYYY-MM-DD)",
        },
        show_qds: {
          type: "boolean",
          description: "Include Qualys Detection Score (QDS) information",
          default: false,
        },
        show_qds_factors: {
          type: "boolean",
          description: "Include QDS contributing factors (EPSS, MITRE ATT&CK, etc.)",
          default: false,
        },
        show_pci_reasons: {
          type: "boolean",
          description: "Show PCI compliance failure reasons",
          default: false,
        },
      },
    },
  },
  {
    name: "qualys_get_knowledgebase_by_cve",
    description: "Search Qualys KnowledgeBase by CVE ID (2024+ feature). Supports QVS score filtering.",
    inputSchema: {
      type: "object",
      properties: {
        cve_ids: {
          type: "string",
          description: "CVE IDs to search (comma-separated, e.g., CVE-2024-1234,CVE-2024-5678)",
        },
        qvs_min: {
          type: "number",
          description: "Minimum QVS (Qualys Vulnerability Score) to filter (0-100)",
        },
        qvs_max: {
          type: "number",
          description: "Maximum QVS to filter (0-100)",
        },
        last_modified_within_days: {
          type: "number",
          description: "Get CVEs with QVS scores modified in last N days (e.g., 15 for recent updates)",
        },
        show_qds: {
          type: "boolean",
          description: "Include QDS information",
          default: true,
        },
        show_qds_factors: {
          type: "boolean",
          description: "Include QDS factors (EPSS, MITRE, CISA KEV)",
          default: false,
        },
      },
    },
  },
  {
    name: "qualys_list_scanners",
    description: "List scanner appliances in your Qualys account.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["physical", "virtual", "containerized", "cloud", "offline"],
          description: "Filter by scanner type",
        },
        status: {
          type: "string",
          enum: ["Online", "Offline"],
          description: "Filter by scanner status",
        },
      },
    },
  },
  {
    name: "qualys_list_option_profiles",
    description: "List option profiles available for scans.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Filter by profile title (partial match)",
        },
      },
    },
  },
  {
    name: "qualys_list_tags",
    description: "List tags for asset management.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Filter by tag name (partial match)",
        },
      },
    },
  },
  {
    name: "qualys_get_activity_log",
    description: "Get activity log entries for audit purposes.",
    inputSchema: {
      type: "object",
      properties: {
        since_datetime: {
          type: "string",
          description: "Get entries since this datetime (YYYY-MM-DDTHH:MM:SSZ)",
        },
        until_datetime: {
          type: "string",
          description: "Get entries until this datetime",
        },
        action: {
          type: "string",
          description: "Filter by action type",
        },
        truncation_limit: {
          type: "number",
          description: "Maximum number of entries (default: 100)",
          default: 100,
        },
      },
    },
  },
];

// Check if credentials are configured
function checkCredentials(): string | null {
  if (!QUALYS_USERNAME || !QUALYS_PASSWORD) {
    return "Qualys credentials not configured. Please set the following environment variables:\n" +
      "  - QUALYS_USERNAME: Your Qualys username\n" +
      "  - QUALYS_PASSWORD: Your Qualys password\n" +
      "  - QUALYS_API_URL: (optional) Your Qualys API URL (defaults to https://qualysapi.qualys.com)";
  }
  return null;
}

// Tool handlers
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Check credentials before making any API calls
  const credentialError = checkCredentials();
  if (credentialError) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${credentialError}`,
        },
      ],
    };
  }

  const client = getApiClient();

  try {
    let response;
    let result: unknown;

    switch (name) {
      case "qualys_list_hosts": {
        const params = buildFormData({
          action: "list",
          ips: args.ips as string,
          ag_ids: args.ag_ids as string,
          ag_titles: args.ag_titles as string,
          truncation_limit: args.truncation_limit as number || 100,
          details: args.details as string || "Basic",
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/asset/host/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_get_host_detections": {
        const params = buildFormData({
          action: "list",
          ips: args.ips as string,
          ids: args.ids as string,
          ag_ids: args.ag_ids as string,
          status: args.status as string,
          severities: args.severities as string,
          qids: args.qids as string,
          truncation_limit: args.truncation_limit as number || 100,
          show_igs: args.show_igs ? "1" : "0",
          include_vuln_type: args.include_vuln_type as string,
          arf_filter_keys: args.arf_filter_keys as string,
          show_epss: args.show_epss ? "1" : "0",
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/asset/host/vm/detection/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_launch_scan": {
        if (!args.scan_title) {
          throw new Error("scan_title is required");
        }
        if (!args.ip && !args.asset_groups && !args.asset_group_ids) {
          throw new Error("At least one of ip, asset_groups, or asset_group_ids is required");
        }
        const params = buildFormData({
          action: "launch",
          scan_title: args.scan_title as string,
          ip: args.ip as string,
          asset_groups: args.asset_groups as string,
          asset_group_ids: args.asset_group_ids as string,
          option_title: args.option_title as string,
          option_id: args.option_id as number,
          iscanner_name: args.iscanner_name as string,
          priority: args.priority as number,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/scan/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_list_scans": {
        const params = buildFormData({
          action: "list",
          scan_ref: args.scan_ref as string,
          state: args.state as string,
          type: args.type as string,
          launched_after_datetime: args.launched_after_datetime as string,
          launched_before_datetime: args.launched_before_datetime as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/scan/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_get_scan_results": {
        if (!args.scan_ref) {
          throw new Error("scan_ref is required");
        }
        const params = buildFormData({
          action: "fetch",
          scan_ref: args.scan_ref as string,
          output_format: args.output_format as string || "xml",
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/scan/", params)
        );
        if (args.output_format === "xml" || !args.output_format) {
          result = await parseXmlResponse(response.data);
        } else {
          result = { data: response.data };
        }
        break;
      }

      case "qualys_cancel_scan": {
        if (!args.scan_ref) {
          throw new Error("scan_ref is required");
        }
        const params = buildFormData({
          action: "cancel",
          scan_ref: args.scan_ref as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/scan/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_pause_scan": {
        if (!args.scan_ref) {
          throw new Error("scan_ref is required");
        }
        const params = buildFormData({
          action: "pause",
          scan_ref: args.scan_ref as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/scan/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_resume_scan": {
        if (!args.scan_ref) {
          throw new Error("scan_ref is required");
        }
        const params = buildFormData({
          action: "resume",
          scan_ref: args.scan_ref as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/scan/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_list_reports": {
        const params = buildFormData({
          action: "list",
          id: args.id as number,
          state: args.state as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/report/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_launch_report": {
        if (!args.template_id) {
          throw new Error("template_id is required");
        }
        const params = buildFormData({
          action: "launch",
          template_id: args.template_id as number,
          report_title: args.report_title as string,
          output_format: args.output_format as string || "pdf",
          ips: args.ips as string,
          asset_group_ids: args.asset_group_ids as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/report/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_download_report": {
        if (!args.id) {
          throw new Error("id is required");
        }
        const params = buildFormData({
          action: "fetch",
          id: args.id as number,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/report/", params, {
            responseType: "arraybuffer",
          })
        );
        // For binary reports, provide info about the download
        result = {
          message: "Report downloaded successfully",
          id: args.id,
          size: response.data.length,
          contentType: response.headers["content-type"],
        };
        break;
      }

      case "qualys_list_asset_groups": {
        const params = buildFormData({
          action: "list",
          ids: args.ids as string,
          title: args.title as string,
          truncation_limit: args.truncation_limit as number || 100,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/asset/group/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_get_knowledgebase": {
        const params = buildFormData({
          action: "list",
          ids: args.ids as string,
          id_min: args.id_min as string,
          id_max: args.id_max as string,
          details: args.details as string || "Basic",
          last_modified_after: args.last_modified_after as string,
          last_modified_before: args.last_modified_before as string,
          published_after: args.published_after as string,
          published_before: args.published_before as string,
          show_qds: args.show_qds ? "1" : "0",
          show_qds_factors: args.show_qds_factors ? "1" : "0",
          show_pci_reasons: args.show_pci_reasons ? "1" : "0",
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/knowledge_base/vuln/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_get_knowledgebase_by_cve": {
        // Build params for CVE-based search
        const cveParams: Record<string, string | number | boolean | undefined> = {
          action: "list",
        };

        if (args.cve_ids) {
          cveParams.cve_id = args.cve_ids as string;
        }
        if (args.qvs_min !== undefined) {
          cveParams.qvs_min = args.qvs_min as number;
        }
        if (args.qvs_max !== undefined) {
          cveParams.qvs_max = args.qvs_max as number;
        }
        if (args.last_modified_within_days) {
          const date = new Date();
          date.setDate(date.getDate() - (args.last_modified_within_days as number));
          cveParams.last_modified_after = date.toISOString().split('T')[0];
        }
        cveParams.show_qds = args.show_qds !== false ? "1" : "0";
        cveParams.show_qds_factors = args.show_qds_factors ? "1" : "0";

        const params = buildFormData(cveParams);
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/knowledge_base/vuln/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_list_scanners": {
        const params = buildFormData({
          action: "list",
          type: args.type as string,
          status: args.status as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/appliance/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_list_option_profiles": {
        const params = buildFormData({
          action: "list",
          title: args.title as string,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/subscription/option_profile/vm/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      case "qualys_list_tags": {
        // Tags are managed via the CSAM/GAV API with different endpoints
        // Using the asset tagging API
        const params = buildFormData({
          action: "list",
        });
        response = await rateLimitedRequest(() =>
          client.post("/qps/rest/2.0/search/am/tag", params, {
            headers: {
              "Content-Type": "application/json",
            },
          })
        );
        result = response.data;
        break;
      }

      case "qualys_get_activity_log": {
        const params = buildFormData({
          action: "list",
          since_datetime: args.since_datetime as string,
          until_datetime: args.until_datetime as string,
          user_action: args.action as string,
          truncation_limit: args.truncation_limit as number || 100,
        });
        response = await rateLimitedRequest(() =>
          client.post("/api/2.0/fo/activity_log/", params)
        );
        result = await parseXmlResponse(response.data);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = handleApiError(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
    };
  }
}

// Main server setup
async function main(): Promise<void> {
  const server = new Server(
    {
      name: "qualys-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args as Record<string, unknown>);
  });

  // Connect to transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Qualys MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
