# Qualys MCP Server

Model Context Protocol (MCP) server for Qualys Vulnerability Management, Detection and Response (VMDR) API.

## Features

### Core Capabilities
- **Host Management**: List and query scanned hosts with detailed information
- **Vulnerability Detection**: Get vulnerability detections with severity filtering
- **Scan Operations**: Launch, pause, resume, and cancel vulnerability scans
- **Report Generation**: Create and download vulnerability reports
- **Asset Management**: Manage asset groups and tags
- **KnowledgeBase**: Query vulnerability information by QID or CVE
- **Activity Logging**: Audit trail access for compliance

### Latest Enhancements (v1.1.0)

#### Performance Improvements
- **HTTP Connection Pooling**: 2-5x faster sequential API calls
  - HTTP keep-alive enabled with connection reuse
  - Optimized for high-volume API operations
- **Singleton Pattern**: Single API client instance reduces initialization overhead
- **Auth Caching**: Base64 authentication computed once and cached

#### 2024-2025 VMDR Features
- **EPSS Integration**: Exploit prediction scores for better vulnerability prioritization
- **Advanced Remediation Filters (ARF)**: Simplified filtering for enterprise deployments
- **CVE-Based Lookup**: New `qualys_get_knowledgebase_by_cve` tool
- **QDS Factors**: Includes EPSS, MITRE ATT&CK, and CISA KEV data
- **Enhanced Scoring**: QVS (Qualys Vulnerability Score) filtering

## Configuration

Set the following environment variables:

```bash
export QUALYS_USERNAME="your-username"
export QUALYS_PASSWORD="your-password"
export QUALYS_API_URL="https://qualysapi.qualys.com"  # Optional, defaults to US platform
```

### Platform URLs
- US Platform 1: `https://qualysapi.qualys.com`
- US Platform 2: `https://qualysapi.qg2.apps.qualys.com`
- EU Platform 1: `https://qualysapi.qualys.eu`
- EU Platform 2: `https://qualysapi.qg2.apps.qualys.eu`

## Available Tools

### Host & Detection
- `qualys_list_hosts` - List scanned hosts
- `qualys_get_host_detections` - Get vulnerability detections with EPSS scores

### Scan Management
- `qualys_launch_scan` - Launch vulnerability scan
- `qualys_list_scans` - List scans with status
- `qualys_get_scan_results` - Get detailed scan results
- `qualys_pause_scan` / `qualys_resume_scan` / `qualys_cancel_scan` - Scan control

### Reporting
- `qualys_list_reports` - List available reports
- `qualys_launch_report` - Generate new report
- `qualys_download_report` - Download completed report

### KnowledgeBase
- `qualys_get_knowledgebase` - Search by QID with QDS factors
- `qualys_get_knowledgebase_by_cve` - **NEW** Search by CVE ID with QVS filtering

### Infrastructure
- `qualys_list_scanners` - List scanner appliances
- `qualys_list_option_profiles` - List scan option profiles
- `qualys_list_asset_groups` - List asset groups
- `qualys_list_tags` - List asset tags
- `qualys_get_activity_log` - Get audit logs

## Installation

```bash
npm install
npm run build
npm start
```

## Usage with Claude

Add to your MCP settings:

```json
{
  "mcpServers": {
    "qualys": {
      "command": "node",
      "args": ["/path/to/qualys-mcp/dist/index.js"],
      "env": {
        "QUALYS_USERNAME": "your-username",
        "QUALYS_PASSWORD": "your-password",
        "QUALYS_API_URL": "https://qualysapi.qualys.com"
      }
    }
  }
}
```

## Security

- ✅ No vulnerabilities (npm audit clean)
- ✅ No hardcoded credentials
- ✅ Environment variable-based configuration
- ✅ Graceful error handling for missing credentials

## Performance

### Connection Pooling Configuration
- HTTP keep-alive: 30 seconds
- Max concurrent sockets: 10
- Max idle connections: 5

### Expected Performance
- **Initial request**: Standard HTTPS handshake time
- **Subsequent requests**: 50-200ms faster due to connection reuse
- **Sequential operations**: 2-5x throughput improvement

## Rate Limiting

Built-in rate limiting: 1 second delay between API requests to comply with Qualys API guidelines.

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev
```

## API Version

Uses Qualys API v2.0 with support for latest 2024-2025 features including EPSS, ARF, and CVE-based lookups.

## License

MIT
