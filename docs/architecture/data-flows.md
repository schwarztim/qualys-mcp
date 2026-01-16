# Data Flow Diagrams

This document describes the data flows within the Qualys MCP Server, including trust boundaries, sensitive data paths, and data transformation stages.

## High-Level Data Flow Diagram

```mermaid
flowchart TB
    subgraph UserZone["User Zone (Trusted)"]
        User[Security Analyst]
    end

    subgraph AIZone["AI Client Zone"]
        AI[AI Assistant]
        NLP[NL Processing]
    end

    subgraph MCPZone["MCP Server Zone"]
        ToolRouter[Tool Router]
        ParamBuilder[Parameter Builder]
        AuthHandler[Auth Handler]
        RateLimiter[Rate Limiter]
        XMLParser[XML Parser]
        ResponseFormatter[Response Formatter]
    end

    subgraph QualysZone["Qualys Zone (External)"]
        APIGateway[API Gateway]
        VulnDB[(Vulnerability Data)]
        AssetDB[(Asset Data)]
        ScanEngine[Scan Engine]
    end

    User -->|Natural Language Query| AI
    AI -->|Tool Call JSON| ToolRouter
    ToolRouter -->|Tool Args| ParamBuilder
    ParamBuilder -->|Form Data| AuthHandler
    AuthHandler -->|Add Basic Auth| RateLimiter
    RateLimiter -->|Rate-limited Request| APIGateway
    APIGateway --> VulnDB
    APIGateway --> AssetDB
    APIGateway --> ScanEngine
    APIGateway -->|XML Response| XMLParser
    XMLParser -->|JSON Object| ResponseFormatter
    ResponseFormatter -->|JSON Content| AI
    AI -->|Natural Language Response| User
```

## Trust Boundaries

```mermaid
graph TB
    subgraph TB1["Trust Boundary 1: User to AI"]
        User[User Input]
        AI1[AI Processing]
    end

    subgraph TB2["Trust Boundary 2: AI to MCP"]
        AI2[AI Tool Call]
        MCP[MCP Server]
    end

    subgraph TB3["Trust Boundary 3: MCP to Qualys"]
        MCP2[MCP Request]
        Qualys[Qualys API]
    end

    User --> AI1
    AI1 --> AI2
    AI2 --> MCP
    MCP --> MCP2
    MCP2 --> Qualys

    style TB1 fill:#90EE90
    style TB2 fill:#87CEEB
    style TB3 fill:#FFD700
```

### Trust Boundary Analysis

| Boundary | From | To | Risks | Mitigations |
|----------|------|-----|-------|-------------|
| **TB1** | User | AI | Prompt injection, malicious queries | AI input sanitization |
| **TB2** | AI | MCP | Malformed tool calls, parameter injection | Schema validation |
| **TB3** | MCP | Qualys | Credential exposure, man-in-the-middle | TLS, Basic Auth |

## Sensitive Data Identification

### Data Classification

| Data Type | Classification | Location | Protection |
|-----------|---------------|----------|------------|
| Qualys Credentials | **SECRET** | Environment variables | Never logged, memory-only |
| Vulnerability Details | **CONFIDENTIAL** | API responses | TLS in transit |
| Host IP Addresses | **INTERNAL** | API requests/responses | TLS in transit |
| Scan Results | **CONFIDENTIAL** | API responses | TLS in transit |
| QID Information | **PUBLIC** | Knowledge Base | No special handling |

### Sensitive Data Flow

```mermaid
flowchart LR
    subgraph Secrets["Secrets (Never Logged)"]
        Username[QUALYS_USERNAME]
        Password[QUALYS_PASSWORD]
    end

    subgraph Processing["Processing"]
        Base64[Base64 Encode]
        AuthHeader[Authorization Header]
    end

    subgraph Transit["In Transit (TLS)"]
        HTTPSRequest[HTTPS Request]
    end

    subgraph Qualys["Qualys"]
        AuthCheck[Auth Validation]
    end

    Username --> Base64
    Password --> Base64
    Base64 --> AuthHeader
    AuthHeader --> HTTPSRequest
    HTTPSRequest --> AuthCheck
```

## Critical User Journey: Vulnerability Query

```mermaid
sequenceDiagram
    participant User
    participant AI as AI Assistant
    participant MCP as Qualys MCP
    participant Qualys as Qualys API

    User->>AI: "Show critical vulnerabilities on 10.0.0.0/24"
    Note over AI: Parse intent and parameters

    AI->>MCP: CallTool(qualys_get_host_detections, {ips: "10.0.0.0-10.0.0.255", severities: "5"})
    Note over MCP: Validate parameters

    MCP->>MCP: Build form data
    Note over MCP: action=list&ips=10.0.0.0-10.0.0.255&severities=5

    MCP->>MCP: Add authentication
    Note over MCP: Authorization: Basic <encoded>

    MCP->>MCP: Rate limit check
    Note over MCP: Wait if < 1s since last request

    MCP->>Qualys: POST /api/2.0/fo/asset/host/vm/detection/
    Note over Qualys: Validate auth, process query

    Qualys-->>MCP: XML Response (detections)
    Note over MCP: Parse XML to JSON

    MCP-->>AI: {content: [{type: "text", text: "<json>"}]}
    Note over AI: Interpret and format

    AI-->>User: "Found 15 critical vulnerabilities..."
```

## Critical User Journey: Launch Scan

```mermaid
sequenceDiagram
    participant User
    participant AI as AI Assistant
    participant MCP as Qualys MCP
    participant Qualys as Qualys API
    participant Scanner as Scanner Appliance
    participant Target as Target Host

    User->>AI: "Scan 10.0.0.50 for vulnerabilities"
    AI->>MCP: CallTool(qualys_launch_scan, {scan_title: "AI Scan", ip: "10.0.0.50"})

    MCP->>MCP: Validate required params
    Note over MCP: scan_title present, ip present

    MCP->>Qualys: POST /api/2.0/fo/scan/ (action=launch)
    Qualys->>Scanner: Dispatch scan job
    Scanner->>Target: Perform vulnerability scan
    Qualys-->>MCP: XML Response (scan_ref)

    MCP-->>AI: {content: [{type: "text", text: "{scan_ref: 'scan/123'}"}]}
    AI-->>User: "Scan launched with reference scan/123"

    Note over User,Target: Scan runs asynchronously

    User->>AI: "Check status of scan 123"
    AI->>MCP: CallTool(qualys_list_scans, {scan_ref: "scan/123"})
    MCP->>Qualys: POST /api/2.0/fo/scan/ (action=list)
    Qualys-->>MCP: XML Response (status: Running)
    MCP-->>AI: {content: [...]}
    AI-->>User: "Scan is currently running..."
```

## Data Transformation Pipeline

```mermaid
flowchart LR
    subgraph Input["Input Stage"]
        ToolArgs[Tool Arguments<br/>JSON Object]
    end

    subgraph Transform["Transformation Stage"]
        Validate[Validate Args]
        Filter[Filter undefined/empty]
        Encode[URL Encode]
        Join[Join with &]
    end

    subgraph Output["Output Stage"]
        FormData[Form Data String]
    end

    ToolArgs --> Validate
    Validate --> Filter
    Filter --> Encode
    Encode --> Join
    Join --> FormData
```

### Example Transformation

**Input (Tool Arguments):**
```json
{
  "ips": "10.0.0.1,10.0.0.2",
  "severities": "4,5",
  "status": undefined,
  "truncation_limit": 100
}
```

**After Filtering:**
```json
{
  "action": "list",
  "ips": "10.0.0.1,10.0.0.2",
  "severities": "4,5",
  "truncation_limit": 100
}
```

**After URL Encoding:**
```
action=list&ips=10.0.0.1%2C10.0.0.2&severities=4%2C5&truncation_limit=100
```

## Response Transformation Pipeline

```mermaid
flowchart LR
    subgraph Input["API Response"]
        XMLData[XML String]
    end

    subgraph Parse["Parse Stage"]
        XMLParser[xml2js Parser]
    end

    subgraph Transform["Transform Stage"]
        FlattenArrays[Flatten Single-Element Arrays]
        MergeAttrs[Merge XML Attributes]
    end

    subgraph Output["MCP Response"]
        JSONContent[JSON Content Block]
    end

    XMLData --> XMLParser
    XMLParser --> FlattenArrays
    FlattenArrays --> MergeAttrs
    MergeAttrs --> JSONContent
```

### Example XML to JSON

**Input (Qualys XML):**
```xml
<HOST_LIST_OUTPUT>
  <RESPONSE>
    <HOST_LIST>
      <HOST>
        <IP>10.0.0.1</IP>
        <ID>12345</ID>
        <TRACKING_METHOD>IP</TRACKING_METHOD>
      </HOST>
    </HOST_LIST>
  </RESPONSE>
</HOST_LIST_OUTPUT>
```

**Output (JSON):**
```json
{
  "HOST_LIST_OUTPUT": {
    "RESPONSE": {
      "HOST_LIST": {
        "HOST": {
          "IP": "10.0.0.1",
          "ID": "12345",
          "TRACKING_METHOD": "IP"
        }
      }
    }
  }
}
```

## Error Flow

```mermaid
flowchart TD
    Request[API Request] --> Check{Success?}

    Check -->|Yes| ParseXML[Parse XML]
    Check -->|No| ErrorType{Error Type}

    ParseXML --> ParseCheck{Parse OK?}
    ParseCheck -->|Yes| ReturnJSON[Return JSON Content]
    ParseCheck -->|No| ReturnRaw[Return Raw Response]

    ErrorType -->|HTTP Error| FormatHTTP[Format HTTP Error<br/>Status + Message]
    ErrorType -->|Connection| FormatConn[Format Connection Error]
    ErrorType -->|Timeout| FormatTimeout[Format Timeout Error]
    ErrorType -->|Unknown| FormatUnknown[Format Unknown Error]

    FormatHTTP --> ReturnError[Return Error Content]
    FormatConn --> ReturnError
    FormatTimeout --> ReturnError
    FormatUnknown --> ReturnError
```

## Data Retention

| Data Type | Retention in MCP | Retention in Qualys |
|-----------|------------------|---------------------|
| Request parameters | Request duration only | Per Qualys policy |
| Response data | Request duration only | Per Qualys policy |
| Credentials | Process lifetime | N/A |
| Error messages | Not persisted | Per Qualys policy |

## Open Questions and Gaps

1. **Credential Caching**: Should Basic Auth token be cached vs. regenerated per request?
2. **Response Size Limits**: What happens with very large responses (memory)?
3. **PII in Responses**: Should host IPs or other PII be redacted in logs?
4. **Audit Trail**: No local audit log of operations performed
5. **Data Masking**: No masking of sensitive fields in error messages
