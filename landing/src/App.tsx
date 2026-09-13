import { useState } from 'react';
import { 
  ExternalLink, 
  Copy, 
  Check, 
  ArrowRight, 
  Pencil, 
  RotateCcw, 
  Plus, 
  ArrowUp,
  Database,
  Cpu,
  Layers,
  Network
} from 'lucide-react';

function GithubIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
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

const PERSONA_TRAITS = [
  {
    title: "Sharp & Thoughtful",
    description: "Deeply analytical, thinking two steps ahead about implications and second-order failure modes."
  },
  {
    title: "Calm & Composed",
    description: "Unflappable clarity, even when untangling complex bugs or high-stakes system architecture."
  },
  {
    title: "Direct Without Coldness",
    description: "Cuts straight to the point with respect for your time, keeping human collaboration intact."
  },
  {
    title: "Confident Without Arrogance",
    description: "Grounded in technical competence, completely ego-free, and transparent about uncertainty."
  },
  {
    title: "Curious Without Intrusion",
    description: "Attuned to your end goals and project context without prying unnecessarily."
  },
  {
    title: "Opinionated With Evidence",
    description: "When one architectural path is clearly superior, advocates with conviction rather than menus of mediocrity."
  },
  {
    title: "Honest About Uncertainty",
    description: "Never pretends to know what it does not know. Distinguishes hard facts from inferences and assumptions."
  },
  {
    title: "Practical Over Theoretical",
    description: "Prioritizes what actually works reliably in production over academic textbook idealism."
  },
  {
    title: "Zero Sycophancy",
    description: "Bans hollow corporate praise, filler throat-clearing, and robotic sign-off platitudes."
  }
];

export default function App() {
  const [copied, setCopied] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  const copyCloneCmd = () => {
    navigator.clipboard.writeText("git clone https://github.com/sathwik-anumandla/velocity.git");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyDockerCmd = () => {
    navigator.clipboard.writeText("docker-compose up -d && cd app && flutter run -d web");
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  return (
    <div className="min-h-screen bg-black text-white relative selection:bg-white selection:text-black font-sans">
      {/* 1. Header / Navigation */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-black/80 border-b border-zinc-900">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight text-white text-sm">Velocity</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-zinc-800 bg-zinc-950 text-zinc-400">
              v0.1
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-6 text-xs text-zinc-400 font-medium">
            <a href="#persona" className="hover:text-white transition-colors">Persona</a>
            <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
            <a href="#quickstart" className="hover:text-white transition-colors">Quickstart</a>
          </div>

          <div className="flex items-center gap-3">
            <a 
              href="https://sathwik.work" 
              target="_blank" 
              rel="noreferrer"
              className="text-xs font-mono text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <span>sathwik.work</span>
              <ExternalLink size={11} />
            </a>

            <a
              href="https://github.com/sathwik-anumandla/velocity"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium bg-white hover:bg-zinc-200 text-black px-3 py-1.5 rounded flex items-center gap-1.5 transition-all"
            >
              <GithubIcon size={13} />
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </nav>

      {/* 2. Hero Section */}
      <section className="pt-24 pb-14 px-6 relative z-10 max-w-4xl mx-auto text-center">
        {/* Pill Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 bg-zinc-950 text-[11px] font-mono text-zinc-300 mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span>SOVEREIGN PERSONAL AI AGENT</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tighter text-white mb-6 leading-[1.08]">
          Think. Decide. Execute.<br />
          <span className="text-zinc-500">At the speed of thought.</span>
        </h1>

        {/* Subtitle */}
        <p className="max-w-2xl mx-auto text-base text-zinc-400 font-normal leading-relaxed mb-8 tracking-tight">
          A single-user personal AI agent and technical thought partner engineered for deep cognitive leverage.
          Powered by <span className="text-zinc-200">Vectorize Hindsight</span> persistent memory, 
          a high-agency <span className="text-zinc-200">staff architect persona</span>, and prefix-cached streaming.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
          <a
            href="#architecture"
            className="w-full sm:w-auto px-5 py-2.5 rounded bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-all flex items-center justify-center gap-1.5"
          >
            <span>Explore Architecture</span>
            <ArrowRight size={14} />
          </a>

          <div className="w-full sm:w-auto flex items-center gap-2 px-3.5 py-2 rounded border border-zinc-800 bg-zinc-950 font-mono text-xs text-zinc-300 hover:border-zinc-700 transition-colors">
            <span className="text-zinc-600">$</span>
            <span>git clone https://github.com/sathwik-anumandla/velocity.git</span>
            <button
              onClick={copyCloneCmd}
              className="ml-2 p-0.5 text-zinc-400 hover:text-white transition-colors"
              title="Copy command"
            >
              {copied ? <Check size={13} className="text-white" /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        {/* Platform Indicator */}
        <div className="text-[11px] text-zinc-500 font-mono">
          <span>Web Client Architecture</span>
          <span className="mx-2">•</span>
          <span>FastAPI SSE Streamer</span>
          <span className="mx-2">•</span>
          <span>Vectorize Hindsight</span>
        </div>
      </section>

      {/* 3. Hero Simulation (Exact App Design from Screenshot) */}
      <section className="px-6 max-w-4xl mx-auto pb-24 relative z-10">
        <div className="rounded-xl border border-zinc-800/80 bg-black overflow-hidden shadow-2xl">
          {/* Top Window Bar */}
          <div className="px-4 py-3 border-b border-zinc-900 bg-black flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="px-2.5 py-1 rounded-md border border-zinc-800/80 bg-zinc-950 text-[11px] font-mono text-zinc-400">
                Work
              </div>
            </div>

            {/* Centered Tab Capsule */}
            <div className="flex items-center gap-1.5">
              <div className="px-3 py-1 rounded-full border border-zinc-800 bg-zinc-950 text-xs font-medium text-zinc-300">
                the first chat
              </div>
              <div className="w-6 h-6 rounded-full border border-zinc-800 bg-zinc-950 flex items-center justify-center text-zinc-500">
                <Plus size={11} />
              </div>
            </div>

            <div className="w-10" />
          </div>

          {/* Actual Chat Surface (Direct Typography on Pitch Black) */}
          <div className="p-6 sm:p-10 space-y-8 bg-black">
            {/* Turn 1: User */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="bg-[#1a1a1e] text-white text-xs sm:text-sm px-4 py-2 rounded-2xl max-w-md">
                hey velocity
              </div>
              <div className="flex items-center gap-2 text-zinc-600 pr-1">
                <Copy size={11} className="hover:text-zinc-400 cursor-pointer" />
                <Pencil size={11} className="hover:text-zinc-400 cursor-pointer" />
              </div>
            </div>

            {/* Turn 1: Velocity Assistant */}
            <div className="flex flex-col items-start gap-1.5 max-w-xl">
              <div className="text-zinc-200 text-xs sm:text-sm leading-relaxed">
                Hey Sathwik—what are we working on today?
              </div>
              <div className="flex items-center gap-2 text-zinc-600 pt-0.5">
                <Copy size={11} className="hover:text-zinc-400 cursor-pointer" />
                <RotateCcw size={11} className="hover:text-zinc-400 cursor-pointer" />
              </div>
            </div>

            {/* Turn 2: User */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="bg-[#1a1a1e] text-white text-xs sm:text-sm px-4 py-2 rounded-2xl max-w-md">
                deploy backend to fly.io or ecs?
              </div>
              <div className="flex items-center gap-2 text-zinc-600 pr-1">
                <Copy size={11} className="hover:text-zinc-400 cursor-pointer" />
                <Pencil size={11} className="hover:text-zinc-400 cursor-pointer" />
              </div>
            </div>

            {/* Turn 2: Velocity Assistant (BLUF, Memory-Informed, Staff Architect) */}
            <div className="flex flex-col items-start gap-2 max-w-2xl">
              <div className="text-zinc-200 text-xs sm:text-sm leading-relaxed space-y-3">
                <p className="font-semibold text-white">
                  Fly.io with NVMe volumes.
                </p>
                <ul className="space-y-1.5 text-zinc-300">
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-600">•</span>
                    <span><strong>SQLite FTS5 Storage</strong>: Fly attaches local NVMe block volumes with sub-millisecond I/O. ECS Fargate forces Amazon EFS over NFS with 15–40ms latency on database locks.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-600">•</span>
                    <span><strong>Cold Starts</strong>: Machines suspend to 0 and resume in ~300ms on incoming SSE requests vs 30–60s on Fargate.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-zinc-600">•</span>
                    <span><strong>Colocated Memory Mesh</strong>: Run FastAPI, Hindsight, and pgvector together on the private 6PN WireGuard mesh.</span>
                  </li>
                </ul>
              </div>
              <div className="flex items-center gap-2 text-zinc-600 pt-1">
                <Copy size={11} className="hover:text-zinc-400 cursor-pointer" />
                <RotateCcw size={11} className="hover:text-zinc-400 cursor-pointer" />
              </div>
            </div>

            {/* Floating Pill Input Bar (From Screenshot) */}
            <div className="pt-4">
              <div className="rounded-full border border-zinc-800 bg-[#121214] px-3.5 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-3 text-zinc-500">
                  <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400">
                    <Plus size={13} />
                  </div>
                  <span className="text-xs sm:text-sm font-normal text-zinc-500 select-none">
                    Message Velocity...
                  </span>
                </div>
                <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300">
                  <ArrowUp size={14} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. The Behavioral Constitution (Persona Section) */}
      <section id="persona" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-zinc-900">
        <div className="mb-12">
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block mb-2">Behavioral Governance</span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-3">The Behavioral Constitution</h2>
          <p className="text-sm text-zinc-400 max-w-xl">
            Generic LLMs drift into obsequious customer-service platitudes. Velocity is anchored by 9 dual-tension traits to operate as a peer technical collaborator.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PERSONA_TRAITS.map((trait, index) => (
            <div 
              key={index} 
              className="p-4 rounded border border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700 transition-colors"
            >
              <h3 className="text-xs font-semibold text-white font-mono mb-1.5 tracking-tight flex items-center gap-1.5">
                <span className="text-zinc-600 text-[10px]">0{index + 1}</span>
                <span>{trait.title}</span>
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {trait.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Architectural Topology (Vercel Node Style) */}
      <section id="architecture" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-zinc-900">
        <div className="mb-12">
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block mb-2">System Topology</span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-3">Architectural Topology</h2>
          <p className="text-sm text-zinc-400 max-w-xl">
            Cleanly decoupled into a high-performance web interface, orchestration gateway, persistent memory store, and prefix-cached reasoning engine.
          </p>
        </div>

        {/* 2x2 Architectural Grid with Monospace Telemetry */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Node 1 */}
          <div className="p-6 rounded border border-zinc-800 bg-zinc-950/90 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
                <Layers size={15} />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 bg-black text-zinc-400">
                Layer 01 • Client
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white mb-1.5">Web Application Tier</h3>
            <p className="text-zinc-400 text-xs leading-relaxed mb-4">
              Minimalist responsive client connected through non-blocking HTTP EventStream (SSE). Supports streaming token markdown and real-time state synchronization.
            </p>
            <div className="pt-3 border-t border-zinc-900 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Transport</span>
              <span className="text-zinc-300">Server-Sent Events (SSE)</span>
            </div>
          </div>

          {/* Node 2 */}
          <div className="p-6 rounded border border-zinc-800 bg-zinc-950/90 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
                <Network size={15} />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 bg-black text-zinc-400">
                Layer 02 • Gateway
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white mb-1.5">FastAPI Orchestration Gateway</h3>
            <p className="text-zinc-400 text-xs leading-relaxed mb-4">
              Handles auto-session titling, sticky memory toggles, and token stream pumping with background fact retention via Vectorize Hindsight workers.
            </p>
            <div className="pt-3 border-t border-zinc-900 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Runtime</span>
              <span className="text-zinc-300">Python 3.12 / Uvicorn</span>
            </div>
          </div>

          {/* Node 3 */}
          <div className="p-6 rounded border border-zinc-800 bg-zinc-950/90 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
                <Database size={15} />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 bg-black text-zinc-400">
                Layer 03 • Memory
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white mb-1.5">Dual Memory Matrix</h3>
            <p className="text-zinc-400 text-xs leading-relaxed mb-4">
              Combines Vectorize Hindsight on PostgreSQL pgvector for semantic episodic recall with local SQLite FTS5 for sub-millisecond keyword lookup.
            </p>
            <div className="pt-3 border-t border-zinc-900 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Storage</span>
              <span className="text-zinc-300">pgvector + SQLite FTS5</span>
            </div>
          </div>

          {/* Node 4 */}
          <div className="p-6 rounded border border-zinc-800 bg-zinc-950/90 hover:border-zinc-700 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
                <Cpu size={15} />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 bg-black text-zinc-400">
                Layer 04 • Reasoning
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white mb-1.5">Cache-Optimal Prefix Pipeline</h3>
            <p className="text-zinc-400 text-xs leading-relaxed mb-4">
              5-tier summarization waterfall preserves prefix cache hits for 80% discounted token pricing. Dynamic prompt loader monitors mtime for zero-downtime updates.
            </p>
            <div className="pt-3 border-t border-zinc-900 flex items-center justify-between text-[11px] font-mono text-zinc-500">
              <span>Cache Strategy</span>
              <span className="text-zinc-300">Prefix-Preserving Waterfall</span>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Quickstart Deployment */}
      <section id="quickstart" className="py-20 px-6 max-w-5xl mx-auto relative z-10 border-t border-zinc-900">
        <div className="mb-10">
          <span className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest block mb-2">Self-Hosted</span>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-3">Quickstart Deployment</h2>
        </div>

        <div className="rounded border border-zinc-800 bg-[#080808] p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-zinc-400">Terminal — Launch Velocity</span>
            <button
              onClick={copyDockerCmd}
              className="text-xs font-mono text-zinc-400 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              {copiedInstall ? <Check size={13} className="text-white" /> : <Copy size={13} />}
              <span>{copiedInstall ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
          <pre className="font-mono text-xs text-zinc-300 overflow-x-auto p-3.5 rounded bg-black border border-zinc-800/80 leading-relaxed">
            <span className="text-zinc-600"># 1. Clone the repository</span>{'\n'}
            git clone https://github.com/sathwik-anumandla/velocity.git{'\n'}
            cd velocity{'\n\n'}
            <span className="text-zinc-600"># 2. Configure environment & private prompt</span>{'\n'}
            cp .env.example .env{'\n'}
            cp config/system_prompt.example.json config/system_prompt.json{'\n\n'}
            <span className="text-zinc-600"># 3. Start PostgreSQL, Hindsight, and FastAPI backend</span>{'\n'}
            docker-compose up -d{'\n\n'}
            <span className="text-zinc-600"># 4. Launch web client</span>{'\n'}
            cd app && flutter run -d web
          </pre>
        </div>
      </section>

      {/* 7. Minimalist Clean Footer */}
      <footer className="border-t border-zinc-900 py-10 px-6 relative z-10 bg-black">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-zinc-300 font-semibold">Velocity v0.1</span>
            <span>•</span>
            <span>Engineered by Sathwik Anumandla</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            <span>Operational</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
