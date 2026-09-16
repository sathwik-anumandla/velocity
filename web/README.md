# Velocity Web UI

Modern, high-performance web interface for Velocity built with React 19, TypeScript, Tailwind CSS, and Vite.

## Architecture

- **Framework**: React 19 + Vite + TypeScript
- **Styling**: Tailwind CSS (dark theme, Satoshi & JetBrains Mono typography)
- **State & Streaming**: Server-Sent Events (SSE) reader for live tokens, agentic steps, reasoning thoughts, and tool executions
- **Markdown**: `react-markdown` with GFM and copyable syntax-highlighted code blocks
- **Popover Controls**: Minimalist, icon-free options menu for:
  - **Thinking Effort**: 6 levels (`none`, `low`, `medium`, `high`, `xhigh`, `max`) in two rows of three
  - **Recall Budget**: `low`, `medium`, `high`
  - **Verbosity**: `low` (prose paragraphs), `medium`, `high`
- **Memory & Search**: Full SQLite FTS5 search across sessions and messages
- **Message Editing**: Edit user messages in-place with branch truncation via backend SQLite API

## Development

```bash
# Install dependencies
npm install

# Start development server with proxy to backend (http://localhost:8000)
npm run dev

# Lint
npm run lint

# Build for production (output to dist/)
npm run build
```

Production builds are served automatically by FastAPI at `/ui/`.
