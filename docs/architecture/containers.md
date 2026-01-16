# Container Diagram - C4 Level 2

This document describes the container-level architecture of the Qualys MCP Server, showing the major runtime containers and their interactions.

## Container Diagram

```mermaid
C4Container
    title Container Diagram - Qualys MCP Server

    Person(user, "Security User", "Interacts via AI assistant")

    Container_Boundary(ai_boundary, "AI Client Environment") {
        Container(ai_runtime, "AI Assistant Runtime", "Claude Desktop/GPT", "Hosts the AI model and MCP client")
    }

    Container_Boundary(mcp_boundary, "MCP Server Process") {
        Container(node_runtime, "Node.js Runtime", "Node.js 18+", "JavaScript execution environment")
        Container(mcp_server, "MCP Server", "TypeScript", "Main server application handling MCP protocol")
        Container(api_client, "Qualys API Client", "Axios", "HTTP client with auth and rate limiting")
        Container(xml_parser, "XML Parser", "xml2js", "Converts Qualys XML to JSON")
    }

    Container_Boundary(qualys_boundary, "Qualys Cloud Platform") {
        Container_Ext(qualys_api, "Qualys API", "REST/XML", "API Gateway for Qualys services")
        ContainerDb_Ext(vuln_db, "Vulnerability Database", "Qualys KB", "Vulnerability definitions and signatures")
        ContainerDb_Ext(asset_db, "Asset Database", "Qualys Assets", "Host and detection data")
    }

    Rel(user, ai_runtime, "Natural language queries")
    Rel(ai_runtime, mcp_server, "Tool invocations", "STDIO/JSON-RPC")
    Rel(mcp_server, api_client, "API requests")
    Rel(api_client, qualys_api, "HTTPS requests", "Basic Auth")
    Rel(qualys_api, xml_parser, "XML responses")
    Rel(xml_parser, mcp_server, "JSON data")
    Rel(qualys_api, vuln_db, "Queries")
    Rel(qualys_api, asset_db, "Queries")
```

## Container Descriptions

### Node.js Runtime

| Attribute | Value |
|-----------|-------|
| **Type** | Runtime Environment |
| **Technology** | Node.js 18+ (ES2022) |
| **Role** | Provides JavaScript execution environment |
| **Configuration** | ES Modules enabled, strict mode |

**Responsibilities:**
- Execute TypeScript-compiled JavaScript
- Manage process lifecycle
- Handle STDIO streams
- Provide async I/O capabilities

### MCP Server

| Attribute | Value |
|-----------|-------|
| **Type** | Application Container |
| **Technology** | TypeScript with MCP SDK |
| **Entry Point** | `dist/index.js` |
| **Protocol** | JSON-RPC 2.0 over STDIO |

**Responsibilities:**
- Implement MCP protocol handlers
- Register and describe available tools
- Route tool calls to appropriate handlers
- Format responses for AI consumption

**Key Dependencies:**
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

### Qualys API Client

| Attribute | Value |
|-----------|-------|
| **Type** | Integration Component |
| **Technology** | Axios HTTP Client |
| **Base URL** | Configurable via `QUALYS_API_URL` |
| **Auth Method** | HTTP Basic Authentication |

**Responsibilities:**
- Construct authenticated HTTP requests
- Encode form data for POST requests
- Enforce rate limiting (1 req/sec)
- Handle connection timeouts (120s)

**Configuration:**
```typescript
{
  baseURL: QUALYS_API_URL,
  timeout: 120000,
  headers: {
    "Authorization": "Basic <base64>",
    "X-Requested-With": "qualys-mcp",
    "Content-Type": "application/x-www-form-urlencoded"
  }
}
```

### XML Parser

| Attribute | Value |
|-----------|-------|
| **Type** | Data Transformation Component |
| **Technology** | xml2js library |
| **Purpose** | Convert Qualys XML responses to JSON |

**Responsibilities:**
- Parse XML response bodies
- Flatten nested structures
- Merge XML attributes into objects
- Handle malformed XML gracefully

**Configuration:**
```typescript
{
  explicitArray: false,
  ignoreAttrs: false,
  mergeAttrs: true
}
```

## Container Interactions

### Request Flow

```mermaid
sequenceDiagram
    participant AI as AI Runtime
    participant MCP as MCP Server
    participant Client as API Client
    participant Parser as XML Parser
    participant API as Qualys API

    AI->>MCP: ListTools request
    MCP-->>AI: Tool definitions (17 tools)

    AI->>MCP: CallTool(qualys_list_hosts, {...})
    MCP->>Client: buildFormData({action: "list", ...})
    Client->>Client: Rate limit check (1s delay)
    Client->>API: POST /api/2.0/fo/asset/host/
    API-->>Client: XML Response
    Client->>Parser: parseXmlResponse(xml)
    Parser-->>MCP: JSON object
    MCP-->>AI: {content: [{type: "text", text: "..."}]}
```

### Error Handling Flow

```mermaid
flowchart TD
    A[API Request] --> B{Success?}
    B -->|Yes| C[Parse XML]
    B -->|No| D{Error Type?}
    D -->|HTTP Error| E[Extract status/message]
    D -->|Connection Error| F[Connection refused message]
    D -->|Timeout| G[Timeout message]
    D -->|Unknown| H[Generic error message]
    C --> I[Return JSON]
    E --> J[Return error text]
    F --> J
    G --> J
    H --> J
```

## Runtime Characteristics

### Memory Model

| Component | Estimated Memory | Notes |
|-----------|-----------------|-------|
| Node.js baseline | ~50 MB | V8 engine overhead |
| MCP SDK | ~10 MB | Protocol handling |
| Axios + dependencies | ~5 MB | HTTP client |
| xml2js | ~2 MB | Parser |
| **Total baseline** | **~70 MB** | Before processing data |

### Process Model

```mermaid
graph LR
    subgraph "Single Process"
        Main[Main Thread]
        EventLoop[Event Loop]
        IO[I/O Operations]
    end

    Main --> EventLoop
    EventLoop --> IO
    IO --> EventLoop
```

- **Single Process**: No worker threads or child processes
- **Event-Driven**: All I/O is non-blocking via Node.js event loop
- **No Clustering**: Designed for single-instance operation

### Communication Channels

| Channel | Direction | Protocol | Format |
|---------|-----------|----------|--------|
| STDIN | Input | JSON-RPC 2.0 | JSON |
| STDOUT | Output | JSON-RPC 2.0 | JSON |
| STDERR | Output | Text | Logs |
| Network | Bidirectional | HTTPS | XML/Form data |

## Scalability Considerations

### Current Limitations

1. **Single Instance**: No horizontal scaling support
2. **No Connection Pooling**: Each request creates new axios instance
3. **Memory-bound**: Large scan results held in memory
4. **Rate Limited**: 1 req/sec regardless of concurrency

### Potential Improvements

1. **Connection Reuse**: Use persistent axios instance
2. **Streaming**: Stream large XML responses instead of buffering
3. **Request Queuing**: Queue concurrent requests when rate limited
4. **Response Caching**: Cache static data (KnowledgeBase entries)

## Open Questions and Gaps

1. **Health Checks**: No built-in health monitoring or liveness probes
2. **Metrics**: No instrumentation for request latency or error rates
3. **Graceful Shutdown**: No signal handling for clean termination
4. **Connection Pooling**: Could axios connections be reused?
5. **Memory Limits**: What happens with very large scan results (10K+ hosts)?
