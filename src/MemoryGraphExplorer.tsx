import cytoscape from "cytoscape";
import {
  Filter,
  Focus,
  List as ListIcon,
  Maximize2,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MemoryGraph, MemoryGraphNode } from "./vite-env";

type MemoryGraphExplorerProps = {
  graph: MemoryGraph | null;
  loading?: boolean;
  error?: string | null;
  onRefresh: () => void | Promise<void>;
  taskGoal: string;
  onTaskGoalChange: (value: string) => void;
};

type KindVisual = {
  color: string;
  borderColor: string;
  shape: cytoscape.Css.NodeShape;
};

const DEFAULT_KIND_VISUAL: KindVisual = {
  color: "#66737d",
  borderColor: "#46535c",
  shape: "ellipse",
};

function visualForKind(kind: string): KindVisual {
  const normalized = kind.toLowerCase();
  if (normalized.includes("thread") || normalized.includes("lineage")) {
    return { color: "#7165a5", borderColor: "#51477f", shape: "round-rectangle" };
  }
  if (normalized.includes("knowledge") || normalized.includes("document")) {
    return { color: "#3b78a0", borderColor: "#285b7c", shape: "rectangle" };
  }
  if (normalized.includes("experience") || normalized.includes("episode") || normalized.includes("event")) {
    return { color: "#b45f52", borderColor: "#8c4339", shape: "ellipse" };
  }
  if (normalized.includes("decision") || normalized.includes("constraint")) {
    return { color: "#a97928", borderColor: "#795619", shape: "hexagon" };
  }
  if (normalized.includes("skill") || normalized.includes("tool")) {
    return { color: "#a24f77", borderColor: "#793657", shape: "tag" };
  }
  if (normalized.includes("checkpoint") || normalized.includes("anchor")) {
    return { color: "#4f7f61", borderColor: "#355b43", shape: "barrel" };
  }
  if (normalized.includes("fact") || normalized.includes("memory")) {
    return { color: "#8a7042", borderColor: "#65502d", shape: "round-hexagon" };
  }
  if (normalized.includes("project")) {
    return { color: "#358273", borderColor: "#1f5f53", shape: "diamond" };
  }
  return DEFAULT_KIND_VISUAL;
}

function kindLabel(kind: string) {
  const labels: Record<string, string> = {
    project: "项目",
    thread: "线程",
    thread_lineage_index: "线程接续",
    knowledge_item: "知识条目",
    experience_card: "经验记忆",
    project_checkpoint: "项目检查点",
    project_anchor: "项目锚点",
    memory_episode: "记忆事件",
    memory_fact: "长期事实",
    skill_candidate: "工具候选",
  };
  return labels[kind] || kind.replace(/[_-]+/g, " ");
}

function clipLabel(value: string, max = 34) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function basename(value: string | null | undefined) {
  if (!value) return "本地来源";
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function formatEvidenceDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const cytoscapeStyles: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      "border-color": "data(borderColor)",
      "border-width": 1.5,
      color: "#30343a",
      "font-family": "Segoe UI, PingFang SC, Microsoft YaHei UI, sans-serif",
      "font-size": 10,
      "font-weight": 600,
      height: "data(size)",
      label: "data(displayLabel)",
      "min-zoomed-font-size": 7,
      shape: "data(shape)" as unknown as cytoscape.Css.NodeShape,
      "text-background-color": "#fbfbfc",
      "text-background-opacity": 0.9,
      "text-background-padding": "3px",
      "text-margin-y": 6,
      "text-max-width": "116px",
      "text-outline-opacity": 0,
      "text-valign": "bottom",
      "text-wrap": "ellipsis",
      width: "data(size)",
    },
  },
  {
    selector: "node.is-activated",
    style: {
      "border-width": 3,
      "overlay-color": "data(color)",
      "overlay-opacity": 0.08,
      "overlay-padding": 6,
    },
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "line-color": "#aeb5bc",
      opacity: 0.48,
      "target-arrow-color": "#aeb5bc",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.7,
      width: "data(width)",
    },
  },
  {
    selector: "node.status-review, node.status-candidate",
    style: {
      "border-color": "#b87920",
      "border-style": "dashed",
      "border-width": 2.5,
    },
  },
  {
    selector: "node.status-stale, node.status-superseded",
    style: {
      "border-color": "#8d969e",
      "border-style": "dashed",
      opacity: 0.58,
    },
  },
  {
    selector: "node.status-disputed, node.status-conflict, node.status-rejected",
    style: {
      "border-color": "#b33e37",
      "border-width": 3,
    },
  },
  {
    selector: "node.is-search-match",
    style: {
      "border-color": "#111827",
      "border-width": 3,
      opacity: 1,
    },
  },
  {
    selector: "node.is-search-dim",
    style: { opacity: 0.16 },
  },
  {
    selector: "edge.is-search-dim",
    style: { opacity: 0.08 },
  },
  {
    selector: "node.is-context-dim",
    style: { opacity: 0.13 },
  },
  {
    selector: "edge.is-context-dim",
    style: { opacity: 0.06 },
  },
  {
    selector: "node.is-neighbor",
    style: { opacity: 0.78 },
  },
  {
    selector: "edge.is-neighbor",
    style: {
      "line-color": "#6f7d88",
      opacity: 0.76,
      label: "data(kind)",
      color: "#4c5963",
      "font-size": 8,
      "text-background-color": "#fbfbfc",
      "text-background-opacity": 0.88,
      "text-background-padding": "2px",
      "target-arrow-color": "#6f7d88",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#101820",
      "border-width": 4,
      opacity: 1,
      "overlay-color": "#101820",
      "overlay-opacity": 0.08,
      "overlay-padding": 8,
      "z-index": 20,
    },
  },
  {
    selector: ".is-kind-hidden",
    style: { display: "none" },
  },
  {
    selector: "node.semantic-mid",
    style: {
      "font-size": 9,
      "text-max-width": "84px",
    },
  },
  {
    selector: "edge.semantic-mid",
    style: { opacity: 0.28 },
  },
  {
    selector: "node.semantic-far",
    style: { label: "" },
  },
  {
    selector: "node.semantic-far.is-activated",
    style: {
      label: "data(displayLabel)",
      "font-size": 9,
    },
  },
  {
    selector: "edge.semantic-far",
    style: { opacity: 0.16 },
  },
];

export default function MemoryGraphExplorer({
  graph,
  loading = false,
  error = null,
  onRefresh,
  taskGoal,
  onTaskGoalChange,
}: MemoryGraphExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const kindSelectId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "list">("graph");

  const graphModel = useMemo(() => {
    const nodes = (graph?.nodes || []).slice(0, 80);
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = (graph?.edges || []).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
    const maxActivation = Math.max(1, ...nodes.map((node) => Number(node.activation || 0)));
    const activatedIds = new Set(graph?.activatedNodeIds || []);
    const nodeElements: cytoscape.ElementDefinition[] = nodes.map((node) => {
      const visual = visualForKind(node.kind);
      const activation = Math.max(0, Number(node.activation || 0));
      const normalizedActivation = Math.min(1, activation / maxActivation);
      const fullLabel = node.title || node.label || node.id;
      return {
        group: "nodes",
        data: {
          id: node.id,
          kind: node.kind,
          color: visual.color,
          borderColor: visual.borderColor,
          shape: visual.shape,
          size: 34 + normalizedActivation * 14,
          displayLabel: clipLabel(fullLabel),
          searchText: [
            fullLabel,
            node.summary,
            node.kind,
            node.projectPath,
            node.threadId,
            ...(node.tags || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase(),
        },
        classes: [
          activatedIds.has(node.id) || activation > 0 ? "is-activated" : "",
          node.status ? `status-${String(node.status).toLowerCase().replace(/[^a-z0-9_-]/g, "")}` : "",
        ].filter(Boolean).join(" "),
      };
    });
    const maxWeight = Math.max(1, ...edges.map((edge) => Number(edge.weight || 0)));
    const edgeElements: cytoscape.ElementDefinition[] = edges.map((edge, index) => ({
      group: "edges",
      data: {
        id: `memory-graph-edge-${index}`,
        source: edge.from,
        target: edge.to,
        kind: edge.kind,
        width: 0.8 + Math.min(1, Number(edge.weight || 0) / maxWeight) * 2.4,
      },
    }));

    return { nodes, edges, elements: [...nodeElements, ...edgeElements] };
  }, [graph]);

  const selectedNode = useMemo(
    () => graphModel.nodes.find((node) => node.id === selectedNodeId) || null,
    [graphModel.nodes, selectedNodeId],
  );

  const kindStats = useMemo(() => {
    const counts = new Map<string, number>();
    graphModel.nodes.forEach((node) => counts.set(node.kind, (counts.get(node.kind) || 0) + 1));
    return [...counts.entries()]
      .map(([kind, count]) => ({ kind, count, visual: visualForKind(kind) }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  }, [graphModel.nodes]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const listNodes = graphModel.nodes.filter((node) => {
    if (kindFilter !== "all" && node.kind !== kindFilter) return false;
    if (!normalizedSearch) return true;
    return [node.title, node.label, node.summary, node.kind, node.projectPath, node.threadId, ...(node.tags || [])]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const visibleNodeCount = listNodes.length;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || graphModel.elements.length === 0) {
      cyRef.current?.destroy();
      cyRef.current = null;
      return;
    }

    cyRef.current?.destroy();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cy = cytoscape({
      container,
      elements: graphModel.elements,
      style: cytoscapeStyles,
      boxSelectionEnabled: false,
      minZoom: 0.22,
      maxZoom: 2.3,
      layout: {
        name: "cose",
        animate: false,
        fit: true,
        padding: 48,
        randomize: true,
        componentSpacing: 72,
        nodeRepulsion: 7200,
        idealEdgeLength: 92,
        edgeElasticity: 110,
        gravity: 0.16,
        numIter: reducedMotion ? 420 : 620,
      },
    });
    cyRef.current = cy;

    cy.on("tap", "node", (event) => setSelectedNodeId(event.target.id()));
    cy.on("tap", (event) => {
      if (event.target === cy) setSelectedNodeId(null);
    });

    let zoomTier = "";
    const applySemanticZoom = () => {
      const zoom = cy.zoom();
      const nextTier = zoom < 0.58 ? "far" : zoom < 0.88 ? "mid" : "near";
      if (nextTier === zoomTier) return;
      zoomTier = nextTier;
      cy.batch(() => {
        cy.elements().removeClass("semantic-far semantic-mid");
        if (nextTier === "far") cy.elements().addClass("semantic-far");
        if (nextTier === "mid") cy.elements().addClass("semantic-mid");
      });
    };
    cy.on("zoom", applySemanticZoom);
    applySemanticZoom();

    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => cy.resize());
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      cy.destroy();
      if (cyRef.current === cy) cyRef.current = null;
    };
  }, [graphModel.elements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const query = searchQuery.trim().toLocaleLowerCase();
    cy.batch(() => {
      cy.elements().removeClass("is-kind-hidden is-search-match is-search-dim");
      cy.nodes().forEach((node) => {
        const hidden = kindFilter !== "all" && node.data("kind") !== kindFilter;
        if (hidden) node.addClass("is-kind-hidden");
        if (query && !hidden) {
          node.addClass(String(node.data("searchText")).includes(query) ? "is-search-match" : "is-search-dim");
        }
      });
      cy.edges().forEach((edge) => {
        const hidden = edge.source().hasClass("is-kind-hidden") || edge.target().hasClass("is-kind-hidden");
        if (hidden) edge.addClass("is-kind-hidden");
        if (query && !hidden && !edge.source().hasClass("is-search-match") && !edge.target().hasClass("is-search-match")) {
          edge.addClass("is-search-dim");
        }
      });
    });
  }, [graphModel.elements, kindFilter, searchQuery]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("is-neighbor is-context-dim");
      cy.nodes().unselect();
      if (!selectedNodeId) return;
      const selected = cy.getElementById(selectedNodeId);
      if (selected.empty()) return;
      selected.select();
      const neighborhood = selected.closedNeighborhood();
      neighborhood.addClass("is-neighbor");
      cy.elements().difference(neighborhood).addClass("is-context-dim");
    });
  }, [graphModel.elements, selectedNodeId]);

  useEffect(() => {
    if (selectedNodeId && !graphModel.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [graphModel.nodes, selectedNodeId]);

  useEffect(() => {
    if (viewMode !== "graph") return;
    const frame = requestAnimationFrame(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();
      const visibleElements = cy.elements().filter((element) => element.visible());
      if (visibleElements.length > 0) cy.fit(visibleElements, 42);
    });
    return () => cancelAnimationFrame(frame);
  }, [viewMode]);

  function fitGraph() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.resize();
    const visibleElements = cy.elements().filter((element) => element.visible());
    if (visibleElements.length > 0) cy.fit(visibleElements, 42);
  }

  function resetGraph() {
    setSearchQuery("");
    setKindFilter("all");
    setSelectedNodeId(null);
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("is-kind-hidden is-search-match is-search-dim is-neighbor is-context-dim");
      cy.nodes().unselect();
    });
    cy.reset();
    cy.fit(cy.elements(), 42);
  }

  function handleKindChange(value: string) {
    setKindFilter(value);
    if (selectedNode && value !== "all" && selectedNode.kind !== value) setSelectedNodeId(null);
  }

  return (
    <section className="memory-graph-explorer" aria-label="本地记忆图谱" data-e2e="memory-graph-explorer">
      <header className="memory-graph-header">
        <div className="memory-graph-heading">
          <div>
            <h2>记忆关系图</h2>
          </div>
          <div className="memory-graph-counts" aria-label="图谱规模">
            <strong data-e2e="memory-graph-node-count">{graphModel.nodes.length}</strong><span>节点</span>
            <strong>{graphModel.edges.length}</strong><span>关系</span>
          </div>
        </div>

        <div className="memory-graph-toolbar">
          <label className="memory-graph-field memory-graph-goal-field">
            <Focus size={15} aria-hidden="true" />
            <span className="memory-graph-sr-only">当前任务目标</span>
            <input
              value={taskGoal}
              onChange={(event) => onTaskGoalChange(event.target.value)}
              placeholder="当前任务目标"
            />
          </label>
          <label className="memory-graph-field">
            <Search size={15} aria-hidden="true" />
            <span className="memory-graph-sr-only">搜索图谱</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索节点、标签或路径"
            />
            {searchQuery ? <span className="memory-graph-match-count">{visibleNodeCount}</span> : null}
          </label>
          <label className="memory-graph-kind-filter" htmlFor={kindSelectId} title="按节点类型筛选">
            <Filter size={15} aria-hidden="true" />
            <span className="memory-graph-sr-only">节点类型</span>
            <select
              id={kindSelectId}
              value={kindFilter}
              onChange={(event) => handleKindChange(event.target.value)}
            >
              <option value="all">全部类型</option>
              {kindStats.map(({ kind, count }) => (
                <option key={kind} value={kind}>{kindLabel(kind)} ({count})</option>
              ))}
            </select>
          </label>
          <div className="memory-graph-toolbar-actions">
            <div className="memory-graph-segmented" role="group" aria-label="图谱显示方式">
              <button
                type="button"
                className={viewMode === "graph" ? "active" : ""}
                aria-pressed={viewMode === "graph"}
                onClick={() => setViewMode("graph")}
              >
                <Network size={14} /> 图谱
              </button>
              <button
                type="button"
                className={viewMode === "list" ? "active" : ""}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                <ListIcon size={14} /> 列表
              </button>
            </div>
            <div className="memory-graph-tool-actions">
              <button type="button" className="memory-graph-icon-button" onClick={resetGraph} title="重置视图" aria-label="重置视图">
                <RotateCcw size={16} />
              </button>
              <button type="button" className="memory-graph-icon-button" onClick={fitGraph} title="适合窗口" aria-label="适合窗口" disabled={graphModel.nodes.length === 0 || viewMode === "list"}>
                <Maximize2 size={16} />
              </button>
              <button type="button" className="memory-graph-icon-button" onClick={() => void onRefresh()} title="刷新图谱" aria-label="刷新图谱" disabled={loading}>
                <RefreshCw size={16} className={loading ? "memory-graph-refreshing" : ""} />
              </button>
            </div>
          </div>
        </div>

        <div className="memory-graph-legend" aria-label="节点类型图例">
          {kindStats.slice(0, 7).map(({ kind, count, visual }) => (
            <span key={kind}>
              <i style={{ backgroundColor: visual.color, borderColor: visual.borderColor }} />
              {kindLabel(kind)} <small>{count}</small>
            </span>
          ))}
          {kindStats.length > 7 ? <span>另有 {kindStats.length - 7} 类</span> : null}
        </div>
      </header>

      <div className={selectedNode ? "memory-graph-stage has-selection" : "memory-graph-stage"}>
        <div className={viewMode === "list" ? "memory-graph-canvas-wrap is-list-mode" : "memory-graph-canvas-wrap"}>
          <div
            ref={containerRef}
            className="memory-graph-canvas"
            aria-label="可缩放的记忆关系图"
            aria-hidden={viewMode !== "graph"}
            data-e2e="memory-graph-canvas"
          />
          {viewMode === "list" && !loading && !error && graphModel.nodes.length > 0 ? (
            <div className="memory-graph-node-list" aria-label="记忆图谱节点">
              {listNodes.length > 0 ? listNodes.map((node) => {
                const visual = visualForKind(node.kind);
                const title = node.title || node.label || node.id;
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={selectedNodeId === node.id ? "memory-graph-node-row active" : "memory-graph-node-row"}
                    aria-pressed={selectedNodeId === node.id}
                    data-e2e="memory-graph-node-row"
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <i style={{ backgroundColor: visual.color, borderColor: visual.borderColor }} />
                    <span className="memory-graph-node-row-copy">
                      <strong>{title}</strong>
                      <small>{node.summary || node.projectPath || "暂无摘要"}</small>
                    </span>
                    <span className="memory-graph-node-row-meta">
                      <small>{kindLabel(node.kind)}</small>
                      {Number(node.activation || 0) > 0 ? <strong>{Number(node.activation).toFixed(1)}</strong> : null}
                    </span>
                  </button>
                );
              }) : (
                <div className="memory-graph-list-empty">没有符合当前筛选条件的节点。</div>
              )}
            </div>
          ) : null}
          {loading ? (
            <div className="memory-graph-state" role="status">
              <RefreshCw size={20} className="memory-graph-refreshing" />
              <strong>正在整理本地关系</strong>
              <span>保留当前任务范围，不读取原始会话正文。</span>
            </div>
          ) : error ? (
            <div className="memory-graph-state is-error" role="alert">
              <strong>图谱暂时不可用</strong>
              <span>{error}</span>
              <button type="button" onClick={() => void onRefresh()}>重新加载</button>
            </div>
          ) : graphModel.nodes.length === 0 ? (
            <div className="memory-graph-state">
              <strong>还没有可显示的关系</strong>
              <span>刷新当前任务的记忆图谱后，节点会出现在这里。</span>
            </div>
          ) : null}
        </div>

        {selectedNode ? (
          <NodeEvidencePanel node={selectedNode} onClose={() => setSelectedNodeId(null)} />
        ) : null}
      </div>
    </section>
  );
}

function NodeEvidencePanel({ node, onClose }: { node: MemoryGraphNode; onClose: () => void }) {
  const visual = visualForKind(node.kind);
  const title = node.title || node.label || node.id;
  const activation = Number(node.activation || 0);
  const reasons = node.whyActivated || [];
  const sources = node.sourceRefs || [];

  return (
    <aside className="memory-graph-inspector" aria-label={`${title} 的证据与详情`} data-e2e="memory-graph-inspector">
      <div className="memory-graph-inspector-head">
        <div className="memory-graph-node-title">
          <i style={{ backgroundColor: visual.color, borderColor: visual.borderColor }} />
          <div>
            <span>{kindLabel(node.kind)}</span>
            <h3>{title}</h3>
          </div>
        </div>
        <button type="button" className="memory-graph-icon-button" onClick={onClose} title="关闭详情" aria-label="关闭详情">
          <X size={16} />
        </button>
      </div>

      {node.summary ? <p className="memory-graph-summary">{node.summary}</p> : null}

      <dl className="memory-graph-metadata">
        <div><dt>激活强度</dt><dd>{activation > 0 ? activation.toFixed(1) : "未激活"}</dd></div>
        <div><dt>记忆层</dt><dd>{node.memoryLayer || "未标注"}</dd></div>
        <div><dt>新鲜度</dt><dd>{node.freshness || "未知"}</dd></div>
        <div><dt>状态</dt><dd>{node.status || "可用"}</dd></div>
        {node.provenance ? <div><dt>来源方式</dt><dd>{node.provenance}</dd></div> : null}
        {typeof node.confidence === "number" ? <div><dt>置信度</dt><dd>{Math.round(node.confidence * 100)}%</dd></div> : null}
        {node.tokenEstimate ? <div><dt>估算规模</dt><dd>{node.tokenEstimate} tokens</dd></div> : null}
        {node.sourceTable ? <div><dt>来源表</dt><dd>{node.sourceTable}</dd></div> : null}
      </dl>

      {node.projectPath || node.threadId ? (
        <section className="memory-graph-detail-section">
          <h4>归属</h4>
          {node.projectPath ? <code title={node.projectPath}>{node.projectPath}</code> : null}
          {node.threadId ? <code title={node.threadId}>Thread {node.threadId}</code> : null}
        </section>
      ) : null}

      {reasons.length > 0 ? (
        <section className="memory-graph-detail-section">
          <h4>命中依据</h4>
          <ul className="memory-graph-reasons">
            {reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
          </ul>
        </section>
      ) : null}

      {node.tags && node.tags.length > 0 ? (
        <section className="memory-graph-detail-section">
          <h4>标签</h4>
          <p className="memory-graph-tags">{node.tags.join(" · ")}</p>
        </section>
      ) : null}

      <section className="memory-graph-detail-section memory-graph-evidence-section">
        <div className="memory-graph-section-heading">
          <h4>来源证据</h4>
          <span>{sources.length}</span>
        </div>
        {sources.length > 0 ? (
          <ul className="memory-graph-evidence-list">
            {sources.map((source, index) => (
              <li key={`${source.path || source.title || "source"}-${index}`}>
                <strong>{source.title || basename(source.path)}</strong>
                <code title={source.path || undefined}>{source.path || "仅保留本地来源指针"}</code>
                <span>{source.kind}{source.updatedAt ? ` · ${formatEvidenceDate(source.updatedAt)}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="memory-graph-empty-evidence">此节点未附带独立来源指针。</p>
        )}
      </section>
    </aside>
  );
}
