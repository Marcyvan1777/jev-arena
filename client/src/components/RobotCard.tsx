import type { MatchConfig, Provider, Robot, Side } from '../../../shared/types.js';
import { RULES, PRIMARY_STRATEGIES, PROVIDER_DISPLAY_NAMES, STRATEGY_PROFILES } from '../../../shared/rules.js';
import { Icon } from './Icon.js';
export function RobotCard({ side, robot, config, disabled, update, updateProvider }: { side: Side; robot?: Robot; config: MatchConfig; disabled: boolean; update: (side: Side, value: MatchConfig['red']) => void; updateProvider: (side: Side, value: Provider) => void }) {
  const health = robot?.hp ?? RULES.hp, stamina = robot?.stamina ?? RULES.stamina;
  const accuracy = robot?.stats.punchesThrown ? Math.round(robot.stats.punchesLanded / robot.stats.punchesThrown * 100) : 0;
  const strategy = STRATEGY_PROFILES[config[side].personality as keyof typeof STRATEGY_PROFILES];
  const brainName = PROVIDER_DISPLAY_NAMES[config.mode === "demo" ? "demo" : config.providers[side]];
  const id = side + '-personality';
  return <section className={'panel robot-card ' + side}>
    <div className="robot-header"><div className="robot-emblem"><Icon name={side === 'red' ? 'bolt' : 'shield'} size={26} /></div><div><span className="micro">{side === 'red' ? '01 / RED CORNER' : '02 / BLUE CORNER'}</span><h2>{config[side].name}</h2></div><span className="corner-dot" /></div>
    <div className="robot-fields"><label className="field-label" htmlFor={side + '-name'}>AI IDENTITY</label><input id={side + '-name'} value={config[side].name} disabled readOnly aria-label={side + ' AI identity'} />
      <label className="field-label" htmlFor={id}>FIGHTING STYLE</label><select id={id} value={config[side].personality} disabled={disabled} onChange={event => update(side, { ...config[side], personality: event.target.value as MatchConfig['red']['personality'] })}>{PRIMARY_STRATEGIES.map(style => <option key={style}>{style}</option>)}</select>
      {strategy && <div className="strategy-profile"><b>{strategy.title}</b><p>{strategy.summary}</p><span>ADVANTAGE · {strategy.strengths}</span><span>RISK · {strategy.risk}</span></div>}</div>
    <div className="robot-fields provider-field"><label className="field-label" htmlFor={side + '-provider'}>AI BRAIN</label><select id={side + '-provider'} value={config.mode === 'demo' ? 'demo' : config.providers[side]} disabled={disabled || config.mode === 'demo'} onChange={event => updateProvider(side, event.target.value as Provider)}><option value="jev">JEV</option><option value="openai">OPENAI GPT</option><option value="claude">ANTHROPIC CLAUDE</option><option value="demo">LOCAL BOT (rule-based baseline)</option></select><span className="micro">{config.mode === 'demo' ? 'DEMO MODE OVERRIDES PROVIDERS' : 'SAME RULES · SAME LEGAL ACTIONS'}</span></div>
    <div className="vitals"><div className="vital-label"><span>CHASSIS INTEGRITY</span><strong>{health}<small> / {RULES.hp}</small></strong></div><div className="hp-track"><i style={{ width: health / RULES.hp * 100 + '%' }} /></div>
      <div className="vital-label energy-label"><span><Icon name="bolt" size={11} /> STAMINA</span><strong>{stamina}<small> / {RULES.stamina}</small></strong></div><div className="energy-track"><i style={{ width: stamina + '%' }} /></div></div>
    <div className="robot-stats"><span>THROWN <b>{robot?.stats.punchesThrown ?? 0}</b></span><span>LANDED <b>{robot?.stats.punchesLanded ?? 0}</b></span><span>ACC <b>{accuracy}%</b></span></div>
    <div className="ability"><Icon name="cross" size={14} /><span>KNOCKDOWNS</span><b>{robot?.stats.knockdowns ?? 0}</b></div>
    <div className="current-action"><span className="micro">CURRENT ACTION</span><span>{robot?.action.replaceAll('_', ' ') ?? 'IN CORNER'}</span></div>
  </section>;
}
