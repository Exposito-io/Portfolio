"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  createHyperliquidSimulationDraft,
  simulateHyperliquidPositions,
} from "@/lib/hyperliquid-simulator";
import type {
  HyperliquidSimulationDraft,
  HyperliquidSimulationPositionDraft,
  HyperliquidSimulationResult,
  HyperliquidSimulatorMarket,
  HyperliquidSimulatorSnapshot,
  PortfolioAccount,
} from "@/lib/types";

type NewPositionForm = {
  marketId: string;
  targetSide: "long" | "short";
  targetSize: number;
  fillPrice: number;
  marginMode: "cross" | "isolated";
  leverage: number;
};

export function HyperliquidSimulator() {
  const [accounts, setAccounts] = useState<PortfolioAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [snapshot, setSnapshot] = useState<HyperliquidSimulatorSnapshot | null>(
    null,
  );
  const [draft, setDraft] = useState<HyperliquidSimulationDraft | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [newPosition, setNewPosition] = useState<NewPositionForm | null>(null);
  const [marginPositionId, setMarginPositionId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAccounts() {
      setLoadingAccounts(true);
      setError("");
      try {
        const response = await fetch("/api/accounts", {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load accounts.");
        const hyperliquidAccounts = (payload.accounts as PortfolioAccount[]).filter(
          (account) => account.source === "hyperliquid",
        );
        setAccounts(hyperliquidAccounts);
        setSelectedAccountId((current) => current || hyperliquidAccounts[0]?.id || "");
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(toErrorMessage(loadError, "Unable to load accounts."));
        }
      } finally {
        if (!controller.signal.aborted) setLoadingAccounts(false);
      }
    }
    void loadAccounts();
    return () => controller.abort();
  }, []);

  const loadSnapshot = useCallback(async (accountId: string) => {
    if (!accountId) return;
    setLoadingSnapshot(true);
    setError("");
    try {
      const response = await fetch(
        `/api/hyperliquid/simulator?accountId=${encodeURIComponent(accountId)}`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load live state.");
      const nextSnapshot = payload.snapshot as HyperliquidSimulatorSnapshot;
      setSnapshot(nextSnapshot);
      setDraft(createHyperliquidSimulationDraft(nextSnapshot));
    } catch (loadError) {
      setSnapshot(null);
      setDraft(null);
      setError(toErrorMessage(loadError, "Unable to load live state."));
    } finally {
      setLoadingSnapshot(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;
    const timeout = window.setTimeout(() => {
      void loadSnapshot(selectedAccountId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadSnapshot, selectedAccountId]);

  const result = useMemo(
    () => (snapshot && draft ? simulateHyperliquidPositions(snapshot, draft) : null),
    [draft, snapshot],
  );
  const marginChanges = useMemo(
    () => getMarginChanges(snapshot, draft),
    [draft, snapshot],
  );
  const isDirty = Boolean(
    draft &&
      result &&
      (Math.abs(draft.collateralAdjustment) > 0 ||
        result.trades.length > 0 ||
        marginChanges.length > 0),
  );

  function selectAccount(accountId: string) {
    if (accountId === selectedAccountId) return;
    if (isDirty && !window.confirm("Discard this simulation and change accounts?")) {
      return;
    }
    setSelectedAccountId(accountId);
  }

  function refreshSnapshot() {
    if (!selectedAccountId) return;
    if (isDirty && !window.confirm("Discard this simulation and refresh live state?")) {
      return;
    }
    void loadSnapshot(selectedAccountId);
  }

  function resetScenario() {
    if (!snapshot) return;
    setDraft(createHyperliquidSimulationDraft(snapshot));
  }

  function updatePosition(
    id: string,
    update: Partial<HyperliquidSimulationPositionDraft>,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            positions: current.positions.map((position) =>
              position.id === id ? { ...position, ...update } : position,
            ),
          }
        : current,
    );
  }

  function removeOrRestorePosition(id: string) {
    if (!snapshot) return;
    const current = snapshot.positions.find((position) => position.id === id);
    if (!current) {
      setDraft((value) =>
        value
          ? { ...value, positions: value.positions.filter((position) => position.id !== id) }
          : value,
      );
      return;
    }
    updatePosition(id, {
      targetSide: current.signedSize >= 0 ? "long" : "short",
      targetSize: Math.abs(current.signedSize),
      fillPrice: current.markPrice,
      marginMode: current.marginMode,
      leverage: current.leverage,
      isolatedMarginAdjustment: 0,
    });
  }

  function openAddPosition() {
    if (!snapshot || !draft) return;
    const usedMarkets = new Set(draft.positions.map((position) => position.marketId));
    const market = snapshot.markets.find((item) => !usedMarkets.has(item.id));
    if (!market) return;
    setNewPosition(newPositionDefaults(market));
  }

  function changeNewPositionMarket(marketId: string) {
    const market = snapshot?.markets.find((item) => item.id === marketId);
    if (market) setNewPosition(newPositionDefaults(market));
  }

  function addPosition(event: FormEvent) {
    event.preventDefault();
    if (!newPosition || !snapshot) return;
    const market = snapshot.markets.find(
      (item) => item.id === newPosition.marketId,
    );
    if (!market) return;
    const id = `new:${market.id}`;
    setDraft((current) =>
      current
        ? {
            ...current,
            positions: [
              ...current.positions,
              {
                id,
                marketId: market.id,
                targetSide: newPosition.targetSide,
                targetSize: newPosition.targetSize,
                fillPrice: newPosition.fillPrice,
                marginMode: newPosition.marginMode,
                leverage: newPosition.leverage,
                isolatedMarginAdjustment: 0,
              },
            ],
          }
        : current,
    );
    setNewPosition(null);
  }

  const availableMarkets = useMemo(() => {
    if (!snapshot || !draft) return [];
    const used = new Set(draft.positions.map((position) => position.marketId));
    return snapshot.markets.filter(
      (market) => market.markPrice > 0 && !used.has(market.id),
    );
  }, [draft, snapshot]);

  const marginDraft = draft?.positions.find(
    (position) => position.id === marginPositionId,
  );
  const marginMarket = snapshot?.markets.find(
    (market) => market.id === marginDraft?.marketId,
  );

  return (
    <main className="simulator-page mx-auto flex w-full max-w-[96rem] flex-col gap-5 px-4 py-7 sm:px-6 lg:px-8">
      <section className="simulator-heading">
        <div>
          <h1>Hyperliquid simulator</h1>
          <p>Model position and collateral changes without placing a trade.</p>
        </div>
        <div className="simulator-account-controls">
          <label className="field-label" htmlFor="simulator-account">
            Account
          </label>
          <div className="flex gap-2">
            <select
              className="input min-w-60"
              disabled={loadingAccounts || accounts.length === 0}
              id="simulator-account"
              onChange={(event) => selectAccount(event.target.value)}
              value={selectedAccountId}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
            <button
              className="button-primary whitespace-nowrap"
              disabled={loadingSnapshot || !selectedAccountId}
              onClick={refreshSnapshot}
              type="button"
            >
              <RefreshCw className={loadingSnapshot ? "animate-spin" : ""} size={16} />
              Refresh live state
            </button>
          </div>
          <p className="simulator-captured">
            {snapshot
              ? `Live state captured ${formatDateTime(snapshot.capturedAt)}`
              : "Select an account to load live state"}
          </p>
        </div>
      </section>

      <div className="simulator-notice" role="note">
        <span><ShieldCheck size={18} />Simulation only — no orders will be sent.</span>
        <small>This tool is for analysis and planning purposes only.</small>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {snapshot?.unsupportedPositionCount ? (
        <div className="alert alert-warning">
          {snapshot.unsupportedPositionCount} non-USDC position
          {snapshot.unsupportedPositionCount === 1 ? " is" : "s are"} excluded from this simulation.
        </div>
      ) : null}

      {!loadingAccounts && accounts.length === 0 ? (
        <div className="empty-state">
          <WalletCards size={28} aria-hidden="true" />
          <div>
            <h2>No Hyperliquid accounts configured</h2>
            <p>Add a Hyperliquid address in Settings to simulate positions.</p>
          </div>
        </div>
      ) : null}

      {loadingSnapshot && !snapshot ? (
        <div className="simulator-loading" role="status">
          <RefreshCw className="animate-spin" size={20} />
          Loading live Hyperliquid state…
        </div>
      ) : null}

      {snapshot && draft && result ? (
        <>
          <SimulatorMetrics result={result} />

          <section className="simulator-positions-panel">
            <div className="simulator-panel-heading">
              <div>
                <h2>Positions</h2>
                <p>Live positions from Hyperliquid with simulated edits</p>
              </div>
              <button
                className="button-primary"
                disabled={!availableMarkets.length}
                onClick={openAddPosition}
                type="button"
              >
                <Plus size={16} /> Add position
              </button>
            </div>
            <div className="simulator-table-scroll">
              <table className="simulator-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>Position value</th>
                    <th>Entry price</th>
                    <th>Mark / fill price</th>
                    <th>Liquidation price</th>
                    <th>Margin</th>
                    <th>Funding</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {result.positions.map((position) => {
                    const positionDraft = draft.positions.find(
                      (item) => item.id === position.id,
                    );
                    if (!positionDraft) return null;
                    const isNew = !snapshot.positions.some(
                      (item) => item.id === position.id,
                    );
                    return (
                      <tr className={position.changed ? "simulator-row-changed" : ""} key={position.id}>
                        <td>
                          <strong>{position.coin}</strong>
                          <small>{position.dex ? `${position.dex} DEX` : "Core perps"}</small>
                        </td>
                        <td>
                          <select
                            aria-label={`${position.coin} target side`}
                            className={`simulator-side-select ${positionDraft.targetSide}`}
                            onChange={(event) =>
                              updatePosition(position.id, {
                                targetSide: event.target.value as "long" | "short",
                              })
                            }
                            value={positionDraft.targetSide}
                          >
                            <option value="long">Long</option>
                            <option value="short">Short</option>
                          </select>
                          <small>{position.marginMode === "cross" ? "Cross" : "Isolated"} · {position.leverage}x</small>
                        </td>
                        <td>
                          <CurrentSimulated
                            current={isNew ? "—" : formatSize(Math.abs(position.currentSignedSize))}
                            simulated={
                              <input
                                aria-label={`${position.coin} target size`}
                                className="simulator-number-input"
                                min="0"
                                onChange={(event) =>
                                  updatePosition(position.id, {
                                    targetSize: Number(event.target.value),
                                  })
                                }
                                step="any"
                                type="number"
                                value={positionDraft.targetSize}
                              />
                            }
                          />
                        </td>
                        <td>
                          <CurrentSimulated
                            current={isNew ? "—" : formatCurrency(position.currentPositionValue)}
                            simulated={formatCurrency(position.simulatedPositionValue)}
                          />
                        </td>
                        <td>
                          <CurrentSimulated
                            current={formatPrice(position.currentEntryPrice)}
                            simulated={formatPrice(position.simulatedEntryPrice)}
                          />
                        </td>
                        <td>
                          <CurrentSimulated
                            current={formatPrice(position.markPrice)}
                            simulated={
                              <input
                                aria-label={`${position.coin} assumed fill price`}
                                className="simulator-number-input"
                                min="0"
                                onChange={(event) =>
                                  updatePosition(position.id, {
                                    fillPrice: Number(event.target.value),
                                  })
                                }
                                step="any"
                                type="number"
                                value={positionDraft.fillPrice}
                              />
                            }
                          />
                        </td>
                        <td>
                          <CurrentSimulated
                            current={formatPrice(position.currentLiquidationPrice)}
                            simulated={formatPrice(position.simulatedLiquidationPrice)}
                            emphasize
                          />
                        </td>
                        <td>
                          <CurrentSimulated
                            current={formatCurrency(position.currentMarginUsed)}
                            simulated={formatCurrency(position.simulatedMarginUsed)}
                          />
                          <small>{position.marginMode === "cross" ? "Shared pool" : "Isolated"}</small>
                        </td>
                        <td>
                          <strong className={toneClass(position.accruedFunding)}>
                            {formatSignedCurrency(position.accruedFunding)}
                          </strong>
                          <small>Accrued</small>
                        </td>
                        <td>
                          <div className="simulator-actions">
                            {positionDraft.targetSize > 0 ? (
                              <button
                                className="button-secondary simulator-close-button"
                                onClick={() => updatePosition(position.id, { targetSize: 0 })}
                                type="button"
                              >
                                Close
                              </button>
                            ) : (
                              <button
                                className="button-secondary simulator-close-button"
                                onClick={() => removeOrRestorePosition(position.id)}
                                type="button"
                              >
                                {isNew ? "Remove" : "Restore"}
                              </button>
                            )}
                            <button
                              aria-label={`Edit ${position.coin} margin settings`}
                              className="icon-button"
                              onClick={() => setMarginPositionId(position.id)}
                              type="button"
                            >
                              <SlidersHorizontal size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!result.positions.length ? (
                    <tr><td className="simulator-empty-row" colSpan={10}>No open or simulated positions.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <ScenarioPanel
            draft={draft}
            marginChanges={marginChanges}
            onCollateralChange={(collateralAdjustment) =>
              setDraft((current) =>
                current ? { ...current, collateralAdjustment } : current,
              )
            }
            onReset={resetScenario}
            onReview={() => setShowReview(true)}
            result={result}
          />
        </>
      ) : null}

      {newPosition && snapshot ? (
        <Modal onClose={() => setNewPosition(null)} title="Add simulated position">
          <form className="simulator-modal-form" onSubmit={addPosition}>
            <label>
              <span className="field-label">Market</span>
              <select
                className="input"
                onChange={(event) => changeNewPositionMarket(event.target.value)}
                value={newPosition.marketId}
              >
                {availableMarkets.map((market) => (
                  <option key={market.id} value={market.id}>{market.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="field-label">Side</span>
                <select className="input" onChange={(event) => setNewPosition({ ...newPosition, targetSide: event.target.value as "long" | "short" })} value={newPosition.targetSide}>
                  <option value="long">Long</option><option value="short">Short</option>
                </select>
              </label>
              <label>
                <span className="field-label">Size</span>
                <input className="input" min="0.00000001" onChange={(event) => setNewPosition({ ...newPosition, targetSize: Number(event.target.value) })} required step="any" type="number" value={newPosition.targetSize} />
              </label>
            </div>
            <label>
              <span className="field-label">Assumed fill price</span>
              <input className="input" min="0" onChange={(event) => setNewPosition({ ...newPosition, fillPrice: Number(event.target.value) })} required step="any" type="number" value={newPosition.fillPrice} />
            </label>
            <div className="simulator-modal-actions">
              <button className="button-secondary" onClick={() => setNewPosition(null)} type="button">Cancel</button>
              <button className="button-primary" type="submit"><Plus size={16} /> Add position</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {marginDraft && marginMarket ? (
        <Modal onClose={() => setMarginPositionId(null)} title={`Margin settings — ${marginMarket.coin}`}>
          <div className="simulator-modal-form">
            <label>
              <span className="field-label">Margin mode</span>
              <select
                className="input"
                disabled={marginMarket.marginMode !== "cross"}
                onChange={(event) => updatePosition(marginDraft.id, { marginMode: event.target.value as "cross" | "isolated", isolatedMarginAdjustment: 0 })}
                value={marginDraft.marginMode}
              >
                {marginMarket.marginMode === "cross" ? <option value="cross">Cross</option> : null}
                <option value="isolated">Isolated</option>
              </select>
            </label>
            <label>
              <span className="field-label">Leverage</span>
              <input className="input" max={marginMarket.maxLeverage} min="1" onChange={(event) => updatePosition(marginDraft.id, { leverage: Number(event.target.value) })} step="1" type="number" value={marginDraft.leverage} />
              <small>Maximum {marginMarket.maxLeverage}x. Cross leverage affects trade eligibility, not liquidation price directly.</small>
            </label>
            {marginDraft.marginMode === "isolated" ? (
              <label>
                <span className="field-label">Isolated margin adjustment (USDC)</span>
                <input className="input" onChange={(event) => updatePosition(marginDraft.id, { isolatedMarginAdjustment: Number(event.target.value) })} step="any" type="number" value={marginDraft.isolatedMarginAdjustment} />
                <small>Positive adds margin; negative removes margin from this position.</small>
              </label>
            ) : null}
            <div className="simulator-modal-actions"><button className="button-primary" onClick={() => setMarginPositionId(null)} type="button">Done</button></div>
          </div>
        </Modal>
      ) : null}

      {showReview && result ? (
        <ReviewDialog onClose={() => setShowReview(false)} result={result} />
      ) : null}
    </main>
  );
}

function SimulatorMetrics({ result }: { result: HyperliquidSimulationResult }) {
  const metrics = result.metrics;
  return (
    <section className="simulator-metrics">
      <MetricCard icon={<WalletCards size={18} />} label="Account equity" value={formatCurrency(metrics.simulatedAccountEquity)} detail={formatDelta(metrics.simulatedAccountEquity - metrics.currentAccountEquity)} />
      <MetricCard icon={<ShieldCheck size={18} />} label="Cross maintenance" value={formatCurrency(metrics.simulatedCrossMaintenance)} detail={formatDelta(metrics.simulatedCrossMaintenance - metrics.currentCrossMaintenance)} />
      <MetricCard icon={<BarChart3 size={18} />} label="Margin buffer" value={formatCurrency(metrics.simulatedMarginBuffer)} detail={formatDelta(metrics.simulatedMarginBuffer - metrics.currentMarginBuffer)} />
      <MetricCard icon={<AlertTriangle size={18} />} label="Nearest liquidation" value={metrics.nearestLiquidation ? `${metrics.nearestLiquidation.coin} at ${formatPrice(metrics.nearestLiquidation.price)}` : "No finite price"} detail={metrics.nearestLiquidation ? `${metrics.nearestLiquidation.distancePercent.toFixed(1)}% from mark` : "Current scenario"} warning={Boolean(metrics.nearestLiquidation && metrics.nearestLiquidation.distancePercent < 10)} />
    </section>
  );
}

function MetricCard({ icon, label, value, detail, warning = false }: { icon: React.ReactNode; label: string; value: string; detail: string; warning?: boolean }) {
  return <article className="simulator-metric"><span className="simulator-metric-icon">{icon}</span><div><p>{label}</p><strong className={warning ? "text-[#b43b32]" : ""}>{value}</strong><small>{detail}</small></div></article>;
}

function ScenarioPanel({ draft, result, marginChanges, onCollateralChange, onReset, onReview }: { draft: HyperliquidSimulationDraft; result: HyperliquidSimulationResult; marginChanges: string[]; onCollateralChange: (value: number) => void; onReset: () => void; onReview: () => void }) {
  const pending = [...result.trades.map((trade) => trade.description), ...marginChanges];
  return (
    <section className="simulator-scenario">
      <div className="simulator-scenario-control">
        <h2>Scenario</h2><p>Adjust collateral and position sizes to see the impact on liquidation prices.</p>
        <label className="mt-5 block"><span className="field-label">USDC collateral adjustment</span><div className="simulator-collateral-input"><input className="input" onChange={(event) => onCollateralChange(Number(event.target.value))} step="any" type="number" value={draft.collateralAdjustment} /><span>USDC</span></div><small>Positive adds collateral. Negative removes collateral.</small></label>
        <button className="button-secondary mt-6" disabled={!pending.length && draft.collateralAdjustment === 0} onClick={onReset} type="button"><RotateCcw size={16} /> Reset scenario</button>
      </div>
      <div className="simulator-pending"><h3>Pending changes ({pending.length + (draft.collateralAdjustment ? 1 : 0)})</h3>{draft.collateralAdjustment ? <div className="simulator-change"><span>Adjust USDC collateral by {formatSignedCurrency(draft.collateralAdjustment)}</span></div> : null}{pending.map((description) => <div className="simulator-change" key={description}><span>{description}</span></div>)}{!pending.length && !draft.collateralAdjustment ? <p className="simulator-no-changes">Edit a position or collateral amount to build a scenario.</p> : null}</div>
      <div className="simulator-legend"><h3>Value display</h3><p><span className="legend-dot current" />Current value<small>Live value from Hyperliquid</small></p><p><span className="legend-dot simulated" />Simulated value<small>Hypothetical value based on your changes</small></p><p><span className="legend-square changed" />Row has simulated changes</p><p><span className="legend-square risk" />Liquidation risk under 10%</p><button className="button-primary mt-auto" onClick={onReview} type="button"><BarChart3 size={16} /> Review impact <ArrowRight size={16} /></button></div>
    </section>
  );
}

function ReviewDialog({ result, onClose }: { result: HyperliquidSimulationResult; onClose: () => void }) {
  return <Modal onClose={onClose} title="Scenario impact"><div className="simulator-review"><div className="simulator-review-metrics"><ReviewMetric label="Account equity" before={result.metrics.currentAccountEquity} after={result.metrics.simulatedAccountEquity} /><ReviewMetric label="Cross maintenance" before={result.metrics.currentCrossMaintenance} after={result.metrics.simulatedCrossMaintenance} /><ReviewMetric label="Margin buffer" before={result.metrics.currentMarginBuffer} after={result.metrics.simulatedMarginBuffer} /></div><div><h3>Hypothetical changes</h3>{result.trades.length ? <ul>{result.trades.map((trade) => <li key={trade.positionId}>{trade.description} at {formatPrice(trade.fillPrice)}</li>)}</ul> : <p>No position changes.</p>}</div><div><h3>Warnings</h3>{result.warnings.length ? <ul className="simulator-warning-list">{result.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}><AlertTriangle size={15} />{warning.message}</li>)}</ul> : <p>No scenario warnings.</p>}</div><div className="simulator-review-note"><ShieldCheck size={17} /><span>This is an estimate only. Nothing will be sent to Hyperliquid.</span></div><div className="simulator-modal-actions"><button className="button-primary" onClick={onClose} type="button">Done</button></div></div></Modal>;
}

function ReviewMetric({ label, before, after }: { label: string; before: number; after: number }) {
  return <div><span>{label}</span><strong>{formatCurrency(after)}</strong><small>Current {formatCurrency(before)}</small></div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="simulator-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" className="simulator-modal" role="dialog"><header><h2>{title}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><X size={18} /></button></header>{children}</section></div>;
}

function CurrentSimulated({ current, simulated, emphasize = false }: { current: React.ReactNode; simulated: React.ReactNode; emphasize?: boolean }) {
  return <div className="simulator-current-simulated"><span><small>Current</small>{current}</span><span className={emphasize ? "simulator-emphasize" : ""}><small>Simulated</small>{simulated}</span></div>;
}

function newPositionDefaults(market: HyperliquidSimulatorMarket): NewPositionForm {
  return { marketId: market.id, targetSide: "long", targetSize: 0, fillPrice: market.markPrice, marginMode: market.marginMode === "cross" ? "cross" : "isolated", leverage: Math.min(5, market.maxLeverage) };
}

function getMarginChanges(snapshot: HyperliquidSimulatorSnapshot | null, draft: HyperliquidSimulationDraft | null) {
  if (!snapshot || !draft) return [];
  return draft.positions.flatMap((position) => {
    const current = snapshot.positions.find((item) => item.id === position.id);
    if (!current) return [];
    if (current.marginMode !== position.marginMode || current.leverage !== position.leverage || Math.abs(position.isolatedMarginAdjustment) > 0) return [`Update ${current.coin} margin settings`];
    return [];
  });
}

function formatCurrency(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }
function formatSignedCurrency(value: number | null | undefined) { if (value === null || value === undefined || !Number.isFinite(value)) return "—"; const formatted = Math.abs(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }); return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatted}`; }
function formatPrice(value: number | null | undefined) { if (value === null || value === undefined || !Number.isFinite(value)) return "—"; return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: value < 10 ? 6 : 2 }); }
function formatSize(value: number) { return value.toLocaleString("en-US", { maximumFractionDigits: 8 }); }
function formatDelta(value: number) { if (Math.abs(value) < 0.005) return "Unchanged"; return `${formatSignedCurrency(value)} vs. current`; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function toneClass(value: number | null) { return value && value > 0 ? "simulator-positive" : value && value < 0 ? "simulator-negative" : ""; }
function toErrorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
