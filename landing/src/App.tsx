import { useState } from 'react';
import { 
  Terminal, 
  Database, 
  Zap, 
  ExternalLink, 
  Copy, 
  Check, 
  Sparkles,
  ArrowRight,
  Server,
  Smartphone,
  Laptop
} from 'lucide-react';

function GithubIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

interface TabContent {
  title: string;
  badge: string;
  userPrompt: string;
  toolsUsed?: string[];
  memoryRecalled?: string[];
  response: string;
  metrics: {
    ttft: string;
    speed: string;
    cacheHit: string;
    model: string;
  };
}

const DEMO_TABS: Record<string, TabContent> = {
  glider: {
    title: "1. Zephyr-9 Architecture",
    badge: "Hardware & Systems Design",
    userPrompt: "What is the exact name and wing loading specification of the autonomous glider I am designing?",
    memoryRecalled: [
      "User designing autonomous carbon-fiber solar glider 'Zephyr-9'",
      "Target wing loading: 4.8 kg/m² with ultra-high aspect ratio carbon spar",
      "Power budget: 140W peak solar input with dual MPPT converters"
    ],
    response: `**Zephyr-9** is your **autonomous carbon-fiber solar glider**.

### Key Specifications from Memory
* **Airframe**: High-altitude solar UAV with carbon-fiber monocoque fuselage.
* **Wing Loading**: **4.8 kg/m²** target (optimized for 65,000 ft cruise density).
* **Power Architecture**: 140W sun-facing PV array with dual MPPT buck-boost converters.

Recommendation: If we run high-altitude tests at night, the battery energy density needs to be at least 320 Wh/kg to survive the dawn descent. Would you like me to model the thermal envelope for the battery pack?`,
    metrics: {
      ttft: "184ms",
      speed: "68 tok/s",
      cacheHit: "100% Hit",
      model: "gpt-5.4-mini"
    }
  },
  memory: {
    title: "2. Hindsight Memory Engine",
    badge: "Cognitive Continuity",
    userPrompt: "I just changed our backend database port to 5433 to avoid conflicts. Remember this for future docker runs.",
    toolsUsed: [
      "hindsight.retain(entity='postgres', bank='personal-agent', facts=['PostgreSQL port remapped to 5433'])"
    ],
    response: `Noted. Updated your persistent architectural memory:
* **PostgreSQL host port**: \`5433\` (mapped to container port \`5432\`).
* **Hindsight Core URL**: \`http://localhost:8888\` updated accordingly.

All future compose commands and test suites will automatically target \`localhost:5433\`.`,
    metrics: {
      ttft: "210ms",
      speed: "74 tok/s",
      cacheHit: "98.4% Hit",
      model: "gpt-5.4-mini"
    }
  },
  research: {
    title: "3. Live Web Intelligence",
    badge: "Tavily Real-Time Tools",
    userPrompt: "Search for the latest Flutter 3.47 desktop entitlements required for macOS network clients.",
    toolsUsed: [
      "tavily_search('flutter macos network client entitlement com.apple.security.network.client 2026')"
    ],
    response: `In macOS AppKit with Flutter, you must enable outgoing client network sockets in your entitlements file:

\`\`\`xml
<!-- macos/Runner/DebugProfile.entitlements & Release.entitlements -->
<key>com.apple.security.network.client</key>
<true/>
\`\`\`

Without this key, sandbox restrictions will silently block outgoing HTTP/SSE streams to \`localhost:8000\`.`,
    metrics: {
      ttft: "340ms",
      speed: "62 tok/s",
      cacheHit: "Live Search",
      model: "gpt-5.4-mini"
    }
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'glider' | 'memory' | 'research'>('glider');
  const [copied, setCopied] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  const copyCloneCmd = () => {
    navigator.clipboard.writeText("git clone https://github.com/sathwik-anumandla/velocity.git");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyDockerCmd = () => {
    navigator.clipboard.writeText("docker-compose up -d && cd app && flutter run -d macos");
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const currentData = DEMO_TABS[activeTab];

  return (
    <div className="min-h-screen bg-black text-white relative selection:bg-white selection:text-black font-sans">
      {/* Background Subtle Grid & Ambient Glow */}
      <div className="absolute inset-0 bg-grid-pattern opacity-60 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-white/[0.07] via-white/[0.02] to-transparent blur-3xl pointer-events-none" />

      {/* 1. Header / Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-black/70 border-b border-zinc-800/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-black font-bold text-lg shadow-[0_0_15px_rgba(255,255,255,0.4)]">
              ⚡
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight text-white text-base">Velocity</span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400">
                v1.0
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
            <a href="#persona" className="hover:text-white transition-colors">Persona</a>
            <a href="#quickstart" className="hover:text-white transition-colors">Quickstart</a>
          </div>

          <div className="flex items-center gap-3">
            <a 
              href="https://sathwik.work" 
              target="_blank" 
              rel="noreferrer"
              className="text-xs font-mono text-zinc-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 transition-all"
            >
              <span>sathwik.work</span>
              <ExternalLink size={12} />
            </a>

            <a
              href="https://github.com/sathwik-anumandla/velocity"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium bg-white hover:bg-zinc-200 text-black px-3.5 py-1.5 rounded-md flex items-center gap-1.5 transition-all shadow-[0_0_20px_rgba(255,255,255,0.2)]"
            >
              <GithubIcon size={14} />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </nav>

      {/* 2. Hero Section */}
      <section className="pt-24 pb-16 px-6 relative z-10 max-w-5xl mx-auto text-center">
        {/* Glowing Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full border border-zinc-800 bg-zinc-900/80 backdrop-blur-sm text-xs font-mono text-zinc-300 mb-8 glow-pill">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>SOVEREIGN PERSONAL AI & COGNITIVE PARTNER</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white via-zinc-200 to-zinc-500 mb-6 leading-[1.08]">
          Think. Decide. Execute.<br />
          <span className="text-white">At the Speed of Thought.</span>
        </h1>

        {/* Subtitle */}
        <p className="max-w-2xl mx-auto text-lg text-zinc-400 font-normal leading-relaxed mb-10">
          Velocity is an autonomous, single-user personal AI agent engineered for deep cognitive leverage.
          Powered by <span className="text-zinc-200 font-medium">Vectorize Hindsight</span> persistent memory, 
          a high-agency <span className="text-zinc-200 font-medium">staff architect persona</span>, and native cross-platform execution.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <a
            href="#architecture"
            className="w-full sm:w-auto px-6 py-3 rounded-lg bg-white text-black font-semibold text-sm hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(255,255,255,0.25)]"
          >
            <span>Explore Architecture</span>
            <ArrowRight size={16} />
          </a>

          <div className="w-full sm:w-auto flex items-center gap-2 px-4 py-3 rounded-lg border border-zinc-800 bg-zinc-950/80 font-mono text-xs text-zinc-300 hover:border-zinc-700 transition-colors">
            <span className="text-zinc-500">$</span>
            <span>git clone https://github.com/sathwik-anumandla/velocity.git</span>
            <button
              onClick={copyCloneCmd}
              className="ml-2 p-1 text-zinc-400 hover:text-white transition-colors"
              title="Copy command"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Quick Platform Badges */}
        <div className="flex items-center justify-center gap-6 text-xs text-zinc-500 font-mono">
          <span className="flex items-center gap-1.5"><Laptop size={14} /> macOS Native (AppKit)</span>
          <span>•</span>
          <span className="flex items-center gap-1.5"><Smartphone size={14} /> Android</span>
          <span>•</span>
          <span className="flex items-center gap-1.5"><Server size={14} /> FastAPI + Hindsight</span>
        </div>
      </section>

      {/* 3. Interactive Studio Simulation Window */}
      <section className="px-6 max-w-5xl mx-auto pb-24 relative z-10">
        <div className="rounded-xl border border-zinc-800 bg-[#080808] shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden">
          {/* Window Header */}
          <div className="border-b border-zinc-800/80 bg-zinc-950/80 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              <span className="ml-3 text-xs font-mono text-zinc-400">velocity-interactive-preview</span>
            </div>

            {/* Session Tabs */}
            <div className="flex items-center gap-1 bg-zinc-900/60 p-1 rounded-lg border border-zinc-800">
              <button
                onClick={() => setActiveTab('glider')}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  activeTab === 'glider' 
                    ? 'bg-zinc-800 text-white shadow-sm' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Zephyr-9 Recall
              </button>
              <button
                onClick={() => setActiveTab('memory')}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  activeTab === 'memory' 
                    ? 'bg-zinc-800 text-white shadow-sm' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Memory Retention
              </button>
              <button
                onClick={() => setActiveTab('research')}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  activeTab === 'research' 
                    ? 'bg-zinc-800 text-white shadow-sm' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Tavily Tools
              </button>
            </div>
          </div>

          {/* Conversation Mockup Body */}
          <div className="p-6 md:p-8 space-y-6 font-sans">
            {/* User Message */}
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center font-mono text-xs font-bold text-zinc-300 shrink-0">
                SA
              </div>
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 max-w-2xl">
                {currentData.userPrompt}
              </div>
            </div>

            {/* Tool / Memory Action Tag */}
            {currentData.memoryRecalled && (
              <div className="ml-12 border-l-2 border-emerald-500/50 pl-4 py-1 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 font-medium">
                  <Database size={13} />
                  <span>Hindsight Cognitive Recall (pgvector matched 3 memories):</span>
                </div>
                {currentData.memoryRecalled.map((m, i) => (
                  <div key={i} className="text-[12px] text-zinc-400 font-mono">
                    ↳ {m}
                  </div>
                ))}
              </div>
            )}

            {currentData.toolsUsed && (
              <div className="ml-12 border-l-2 border-sky-500/50 pl-4 py-1 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-mono text-sky-400 font-medium">
                  <Terminal size={13} />
                  <span>Invoked Tool Execution:</span>
                </div>
                {currentData.toolsUsed.map((t, i) => (
                  <div key={i} className="text-[12px] text-zinc-400 font-mono">
                    ↳ {t}
                  </div>
                ))}
              </div>
            )}

            {/* Velocity Response */}
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center font-bold text-sm shrink-0 shadow-[0_0_10px_rgba(255,255,255,0.4)]">
                ⚡
              </div>
              <div className="bg-black/60 border border-zinc-800/80 rounded-xl p-5 text-sm text-zinc-200 max-w-3xl leading-relaxed whitespace-pre-line font-sans">
                {currentData.response}
              </div>
            </div>
          </div>

          {/* Telemetry Footer Bar */}
          <div className="border-t border-zinc-800 bg-zinc-950/90 px-6 py-3 flex flex-wrap items-center justify-between text-xs font-mono text-zinc-400 gap-4">
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>TTFT: <strong className="text-white">{currentData.metrics.ttft}</strong></span>
              </span>
              <span>Speed: <strong className="text-white">{currentData.metrics.speed}</strong></span>
              <span>Prefix Cache: <strong className="text-emerald-400">{currentData.metrics.cacheHit}</strong></span>
            </div>
            <div className="text-zinc-500">
              Engine: <span className="text-zinc-300">{currentData.metrics.model}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Core Pillars (Bento Grid) */}
      <section id="features" className="py-20 px-6 max-w-6xl mx-auto relative z-10 border-t border-zinc-800/80">
        <div className="text-center mb-16">
          <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">Engineered for Technical High Agency</h2>
          <p className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Built Different Than Typical AI Chatbots</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1 */}
          <div className="p-8 rounded-xl border border-zinc-800/90 bg-[#090909] hover:border-zinc-700 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
              <Database size={20} className="text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Deterministic Cognitive Memory</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              Integrated with <strong className="text-zinc-200">Vectorize Hindsight</strong> on PostgreSQL pgvector and SQLite FTS5.
              Preserves facts, user preferences, and hardware architectures across sessions without memory drift or hallucinations.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
              <span>● Sub-millisecond FTS5 recall</span>
              <span>•</span>
              <span>Zero context dilution</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-8 rounded-xl border border-zinc-800/90 bg-[#090909] hover:border-zinc-700 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
              <Sparkles size={20} className="text-amber-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Bounded Staff Architect Persona</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              Direct without being cold. Confident without being arrogant. Zero corporate sycophancy, no hollow praise, and no lazy <code className="text-zinc-300">// TODO</code> comments in code. Delivers the bottom line first (BLUF).
            </p>
            <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
              <span>● Bottom-Line-Up-Front</span>
              <span>•</span>
              <span>9 Dual-Tension Traits</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-8 rounded-xl border border-zinc-800/90 bg-[#090909] hover:border-zinc-700 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
              <Zap size={20} className="text-sky-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Cache-Optimal Prefix Pipeline</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              Implements a 5-tier waterfall summarization preserving the last 6 messages verbatim.
              Guarantees maximum Responses API prefix cache hits, reducing token latency by up to 80%.
            </p>
            <div className="flex items-center gap-2 text-xs font-mono text-sky-400">
              <span>● 80% discounted input billing</span>
              <span>•</span>
              <span>Instant KV Cache Hits</span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="p-8 rounded-xl border border-zinc-800/90 bg-[#090909] hover:border-zinc-700 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white mb-6 group-hover:scale-110 transition-transform">
              <Laptop size={20} className="text-purple-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Cross-Platform Native Speed</h3>
            <p className="text-zinc-400 text-sm leading-relaxed mb-4">
              Clean Flutter client compiled directly to native macOS AppKit, Android APK, and high-framerate Web.
              Streams responses through non-blocking HTTP EventStream (SSE).
            </p>
            <div className="flex items-center gap-2 text-xs font-mono text-purple-400">
              <span>● macOS Desktop</span>
              <span>•</span>
              <span>Android</span>
              <span>•</span>
              <span>Web CanvasKit</span>
            </div>
          </div>
        </div>
      </section>

      {/* 5. System Architecture Pipeline */}
      <section id="architecture" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-zinc-800/80">
        <div className="text-center mb-16">
          <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">Full-Stack System Topology</h2>
          <p className="text-3xl font-bold tracking-tight text-white">How Velocity Processes Thought</p>
        </div>

        <div className="space-y-4">
          {/* Pipeline Step 1 */}
          <div className="p-5 rounded-lg border border-zinc-800/80 bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white font-mono text-sm">
                01
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm">Client Interaction Tier</h4>
                <p className="text-xs text-zinc-400">Flutter UI with responsive split-screen desktop & mobile adaptive layouts</p>
              </div>
            </div>
            <div className="text-xs font-mono text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 w-fit">
              macOS / Android / Web
            </div>
          </div>

          {/* Pipeline Step 2 */}
          <div className="p-5 rounded-lg border border-zinc-800/80 bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white font-mono text-sm">
                02
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm">FastAPI Orchestrator & Classifier</h4>
                <p className="text-xs text-zinc-400">Auto-session titling, SSE EventStream pump, and dynamic memory routing</p>
              </div>
            </div>
            <div className="text-xs font-mono text-emerald-400 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 w-fit">
              Python 3.12 / Uvicorn
            </div>
          </div>

          {/* Pipeline Step 3 */}
          <div className="p-5 rounded-lg border border-zinc-800/80 bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white font-mono text-sm">
                03
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm">Memory & Tool Subsystems</h4>
                <p className="text-xs text-zinc-400">Hindsight semantic memory bank, SQLite FTS5 search, and live Tavily web search</p>
              </div>
            </div>
            <div className="text-xs font-mono text-sky-400 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 w-fit">
              pgvector + SQLite FTS5
            </div>
          </div>

          {/* Pipeline Step 4 */}
          <div className="p-5 rounded-lg border border-zinc-800/80 bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white font-mono text-sm">
                04
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm">Reasoning Engine</h4>
                <p className="text-xs text-zinc-400">Responses API with prefix caching and dynamically reloaded private system prompt</p>
              </div>
            </div>
            <div className="text-xs font-mono text-amber-400 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 w-fit">
              OpenAI Responses API
            </div>
          </div>
        </div>
      </section>

      {/* 6. Quickstart / Deployment */}
      <section id="quickstart" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-zinc-800/80">
        <div className="text-center mb-12">
          <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">Self-Hosted Deployment</h2>
          <p className="text-3xl font-bold tracking-tight text-white">Up and Running in 3 Minutes</p>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-[#0a0a0a] p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-mono text-zinc-400">Terminal — Launch Velocity</span>
            <button
              onClick={copyDockerCmd}
              className="text-xs font-mono text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              {copiedInstall ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              <span>{copiedInstall ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="font-mono text-xs sm:text-sm text-zinc-300 overflow-x-auto p-4 rounded-lg bg-black border border-zinc-800/80 leading-relaxed">
            <span className="text-zinc-500"># 1. Clone the repository</span>{'\n'}
            git clone https://github.com/sathwik-anumandla/velocity.git{'\n'}
            cd velocity{'\n\n'}
            <span className="text-zinc-500"># 2. Configure environment & private prompt</span>{'\n'}
            cp .env.example .env{'\n'}
            cp config/system_prompt.example.json config/system_prompt.json{'\n\n'}
            <span className="text-zinc-500"># 3. Start PostgreSQL, Hindsight, and FastAPI backend</span>{'\n'}
            docker-compose up -d{'\n\n'}
            <span className="text-zinc-500"># 4. Launch native client</span>{'\n'}
            cd app && flutter run -d macos
          </pre>
        </div>
      </section>

      {/* 7. Footer */}
      <footer className="border-t border-zinc-800/80 py-12 px-6 relative z-10 bg-black">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 text-sm text-zinc-500">
          <div className="flex items-center gap-3">
            <span className="text-white font-bold">⚡ Velocity</span>
            <span>•</span>
            <span>Designed & Engineered by <a href="https://sathwik.work" target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-white underline underline-offset-4">Sathwik Anumandla</a></span>
          </div>

          <div className="flex items-center gap-6 text-xs font-mono">
            <a href="https://github.com/sathwik-anumandla/velocity" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">GitHub Repository</a>
            <a href="https://sathwik.work" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">Portfolio</a>
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Engine Active</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
