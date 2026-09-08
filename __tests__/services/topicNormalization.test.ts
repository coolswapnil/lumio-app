import { normalizeTopicLabel, TOPIC_CANONICAL_MAP } from '../../src/services/topicNormalization';

describe('normalizeTopicLabel', () => {
  // ── Step 1: lowercase + trim ──────────────────────────────────────────────

  it('lowercases an uppercase label', () => {
    expect(normalizeTopicLabel('Stock Market')).toBe('stock market');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTopicLabel('  investing  ')).toBe('investing');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeTopicLabel('')).toBe('');
  });

  // ── Step 2: possessive strip ──────────────────────────────────────────────

  it("strips possessive 's from a single word (Buffett's → buffett)", () => {
    expect(normalizeTopicLabel("Buffett's")).toBe('buffett');
  });

  it("strips possessive 's mid-phrase ('Buffett's strategy')", () => {
    expect(normalizeTopicLabel("Buffett's strategy")).toBe('buffett strategy');
  });

  it("strips possessive 's from multiple words in the same phrase", () => {
    // "Peter's" → "Peter", "Lynch's" → "Lynch"; "picks" is 5 chars so step 4 leaves it
    expect(normalizeTopicLabel("Peter's Lynch's picks")).toBe('peter lynch picks');
  });

  // ── Step 3: leading stop-word strip ───────────────────────────────────────

  it("strips leading 'the' ('the stock market' → 'stock market')", () => {
    // "stock" (5 chars) not stripped; "market" (6 chars, ends in 't') not stripped
    expect(normalizeTopicLabel('the stock market')).toBe('stock market');
  });

  it("strips leading 'a' ('a guide to investing' → 'guide to investing')", () => {
    expect(normalizeTopicLabel('a guide to investing')).toBe('guide to investing');
  });

  it("strips leading 'an' ('an introduction to bonds')", () => {
    // "introduction" (12 chars, ends in 'n') not stripped; "bonds" (5 chars) not stripped
    expect(normalizeTopicLabel('an introduction to bonds')).toBe('introduction to bonds');
  });

  it("strips only one leading stop word ('the a fund' → 'a fund')", () => {
    expect(normalizeTopicLabel('the a fund')).toBe('a fund');
  });

  it("does not strip stop words from the middle of a phrase", () => {
    expect(normalizeTopicLabel('investing for retirement')).toBe('investing for retirement');
  });

  // ── Step 4: plural reduction (≥ 6 chars before stripping) ─────────────────

  it("strips trailing 's' from a word ≥ 6 chars ('markets' → 'market')", () => {
    // "markets" is 7 chars → stripped → "market"
    expect(normalizeTopicLabel('markets')).toBe('market');
  });

  it("does NOT strip trailing 's' from a word < 6 chars ('bonds' stays 'bonds')", () => {
    // "bonds" is 5 chars → not stripped
    expect(normalizeTopicLabel('bonds')).toBe('bonds');
  });

  it("'stocks' (6 chars) is stripped to 'stock' before canonical lookup", () => {
    // "stocks" → step4 → "stock" — no canonical entry → returns "stock"
    expect(normalizeTopicLabel('stocks')).toBe('stock');
  });

  // ── Step 5: canonical map hits ────────────────────────────────────────────

  it("'dividend shares' → 'dividend investing' via canonical map", () => {
    expect(normalizeTopicLabel('dividend shares')).toBe('dividend investing');
  });

  it("'machine learning' → 'artificial intelligence' via canonical map", () => {
    expect(normalizeTopicLabel('machine learning')).toBe('artificial intelligence');
  });

  it("'deep learning' → 'artificial intelligence' via canonical map", () => {
    expect(normalizeTopicLabel('deep learning')).toBe('artificial intelligence');
  });

  it("'neural networks' → 'artificial intelligence' via step 4 + canonical lookup", () => {
    // "networks" (8 chars, ends in 's') → step 4 → "network"
    // result = "neural network" → canonical map → "artificial intelligence"
    expect(normalizeTopicLabel('neural networks')).toBe('artificial intelligence');
  });

  // ── Canonical map miss ────────────────────────────────────────────────────

  it('leaves an unknown label unchanged after normalization', () => {
    expect(normalizeTopicLabel('personal finance')).toBe('personal finance');
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('is idempotent: running twice returns the same result', () => {
    const once = normalizeTopicLabel('The Dividend Stocks');
    const twice = normalizeTopicLabel(once);
    expect(once).toBe(twice);
  });

  // ── Plural reduction interacting with canonical map ───────────────────────

  it("'stock markets' → step4 → 'stock market' → canonical lookup → 'stock market'", () => {
    // "stock" (5 chars) not stripped; "markets" (7 chars) → "market"
    // result = "stock market" — no canonical entry → stays "stock market"
    expect(normalizeTopicLabel('stock markets')).toBe('stock market');
  });

  it("'dividend stocks' → step 4 → 'dividend stock' → canonical map → 'dividend investing'", () => {
    // "dividend" (8 chars, ends in 'd') unchanged; "stocks" (6 chars) → "stock"
    // result = "dividend stock" → TOPIC_CANONICAL_MAP["dividend stock"] = "dividend investing"
    expect(normalizeTopicLabel('dividend stocks')).toBe('dividend investing');
  });

  // ── TOPIC_CANONICAL_MAP export ────────────────────────────────────────────

  it('TOPIC_CANONICAL_MAP is exported and contains expected entries', () => {
    // Keys are post-step-4 forms (plurals ≥6 chars already stripped)
    expect(TOPIC_CANONICAL_MAP['dividend share']).toBe('dividend investing');
    expect(TOPIC_CANONICAL_MAP['renting']).toBe('rental properties');
    expect(TOPIC_CANONICAL_MAP['real estate listing']).toBe('property investment');
  });
});
