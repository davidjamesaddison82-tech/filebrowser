/**
 * The conformed view of a dataset (round 3, G1f and G11a).
 *
 * A stored record that fails validation is still loaded, flagged with an integrity warning (D16), but
 * its fields can hold anything: a list where a status should be, a number as a lifecycle state, an
 * object as a title, null as a list of modules. Such a record can no longer arrive through a proposal
 * (the database checks the values that drive labels, and accepting re-validates the record), but an
 * owner-level import that skips the pack validator can still store one. Every derivation in derive.ts
 * expects the shapes the record schemas declare, and a field of the wrong kind made it throw — on the
 * screens, and in the REST and MCP tools alike.
 *
 * So every reader computes on the dataset with each invalid record conformed to its schema, worked out
 * once per loaded revision by the store (store.ts), field by field from the schema itself (no list of
 * fields to keep in step):
 *   - a text or listed value of the wrong kind, or outside its list, becomes "Not a valid value", which
 *     matches no status, so it never reads as an acceptance;
 *   - a reference (an id) of the wrong kind becomes null: it points nowhere rather than at a record
 *     that does not exist;
 *   - a number or true/false of the wrong kind becomes null;
 *   - a list of the wrong kind becomes [], and an element of the wrong kind is left out: an element of
 *     a list is of the wrong kind too when one of its required listed values or references is (a loop
 *     step with no valid stage, a connection to no valid id);
 *   - an object of the wrong kind becomes null where the schema allows null; where it requires one (a
 *     build's statement) it becomes one whose fields are all not valid ("Not a valid value", with no
 *     valid label and no quotation); a lifecycle of the wrong kind has every dimension not valid;
 *   - a missing field takes its schema default only when that default asserts nothing (an empty list or
 *     object, null, false, or a neutral value such as "unknown" or "none"); any other default (a
 *     recommendation's made_by, an empty text) is "Not a valid value" (ROUND4 H6d);
 *   - then, for a value of the right kind that still breaks its field's rule (an id that does not look
 *     like an id, a date that is not a date, a quotation too short to be one), the value becomes null
 *     where null is allowed, and otherwise the list element holding it is left out, or it becomes not
 *     valid as above. So a three-letter "quotation" does not count as a citation. A rule across the
 *     fields of an object (a lifecycle "yes" with no quotation) is left to the derivations, which never
 *     count such a statement and list it as an unverified claim.
 * Fields a record does not declare at its top level are passed on as stored (record schemas keep keys they
 * do not know, so an older application can read a newer pack): the screens read those through the guards
 * in src/lib/ui/guards.ts. Inside a declared object that drops unknown keys when it parses (a claim, a
 * citation, a lifecycle entry), they are dropped, as parsing would. A valid record is passed on untouched. Conforming can only take a meaning
 * away, never add one: no value becomes a positive state, an acceptance or a link that was not there.
 *
 * ROUND4 H6. Conforming is not enough on its own: a value that survives conforming in a record that fails
 * validation could still count (an evidence record whose result is stored as a string kept its type
 * "founder_acceptance"), and what conforming leaves out (a list of the wrong kind, an element with a
 * label of the wrong kind) could be negative. So each conformed record's meta says `valid: false`
 * (isReadable), and every derivation counts as proof only records that pass validation; and the view
 * keeps, for each module, the records that fail validation and name it anywhere in their stored data
 * (unreadableNaming), so that its figures say they may be incomplete, and those records' stored data, so
 * that search still finds what they say.
 *
 * Writing is a different matter. A proposal is compared with the record as stored, its base version is
 * the stored version, and the acceptance rules and the "before" values a founder reviews are the
 * stored ones (services.ts), so the store hands every reader both forms.
 */
import { Dataset, type Envelope, type RecordMeta } from "./dataset";
import { type AnyRecord, RECORD_SCHEMAS, type RecordType, safeParseRecord } from "./schemas";

/** What HQ shows, and holds in the conformed view, in place of a value of the wrong kind or one outside its field's list. */
export const NOT_VALID = "Not a valid value";

/**
 * L8: what HQ says, on the screens and beside the empty list in an API answer, of a list that is empty
 * only because conforming emptied it (a record that fails validation, whose stored value there is not
 * an empty list). Never "nothing": the stored record may hold something HQ cannot read.
 */
export const UNREADABLE_LIST = "Not readable — see the stored record";

declare const CONFORMED: unique symbol;

/**
 * A dataset whose every record has the shape its schema declares: the stored dataset with each record
 * that fails validation conformed (conformDataset). The derivations in derive.ts take only this type,
 * so they cannot be given the dataset as stored by accident.
 */
export type DatasetView = Dataset & { readonly [CONFORMED]: true };

type Def = { type: string; [key: string]: unknown };
type Schema = { _zod: { def: Def } };

/** Left out of a list: an element of the wrong kind. */
const DROP = Symbol("drop");

/** Fields that name another record. One of the wrong kind becomes null, not a text that links nowhere. */
const isReferenceKey = (key: string) => key === "id" || key === "to" || key.endsWith("_id");

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const WRAPPERS = ["optional", "nullable", "default", "prefault", "catch", "readonly", "nonoptional"];

/** Listed values that say nothing either way: the only text a default may give a conformed record (H6d). */
const NEUTRAL_VALUES: readonly string[] = ["unknown", "none", "unreviewed", "not_applicable", "no_evidence", "unissued"];

/** A default that asserts nothing: an empty list or object, null, false, or a neutral listed value. */
export function isNeutralDefault(value: unknown): boolean {
  if (value === null || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return typeof value === "string" && NEUTRAL_VALUES.includes(value);
}

function defaultOf(def: Def): unknown {
  const value = typeof def.defaultValue === "function" ? (def.defaultValue as () => unknown)() : def.defaultValue;
  return structuredClone(value);
}

/** The schema inside optional, nullable, default and pipe. */
function unwrap(schema: Schema): Schema {
  let s = schema;
  for (;;) {
    const def = s._zod.def;
    if (WRAPPERS.includes(def.type)) s = def.innerType as Schema;
    else if (def.type === "pipe") s = def.in as Schema;
    else return s;
  }
}

/** What a schema holds once optional, nullable and default are looked through: "string", "enum", "object", "array"… */
const innerKind = (schema: Schema): string => unwrap(schema)._zod.def.type;

/** A field that must be given: not optional, not nullable, and with no default. */
function isRequired(schema: Schema): boolean {
  return !["optional", "nullable", "default", "prefault"].includes(schema._zod.def.type);
}

/** One value conformed to its schema. `key` is the field's name, for references; `inList` when it is an element of a list. */
function conform(schema: Schema, value: unknown, key: string, inList: boolean): unknown {
  const def = schema._zod.def;
  switch (def.type) {
    case "optional":
      return value === undefined ? undefined : conform(def.innerType as Schema, value, key, inList);
    case "nullable": {
      if (value === null) return null;
      // Where null is allowed, an object or list of the wrong kind is null, not an invented one.
      const inner = innerKind(def.innerType as Schema);
      if ((inner === "object" && !isPlainObject(value)) || (inner === "array" && !Array.isArray(value))) return inList ? DROP : null;
      return conform(def.innerType as Schema, value, key, inList);
    }
    case "default":
    case "prefault": {
      if (value !== undefined) return conform(def.innerType as Schema, value, key, inList);
      // ROUND4 H6d: a default never asserts. A missing field takes its default only when that default
      // says nothing (an empty list or object, null, false, or a neutral listed value); any other default
      // (a recommendation's made_by, "Not stated"; an empty text) is not valid instead.
      const fallback = defaultOf(def);
      return isNeutralDefault(fallback) ? fallback : NOT_VALID;
    }
    case "catch":
    case "readonly":
    case "nonoptional":
      return conform(def.innerType as Schema, value, key, inList);
    case "pipe":
      return conform(def.in as Schema, value, key, inList);
    case "string":
      // An id must name something: an empty one is no reference at all.
      if (typeof value === "string" && (value !== "" || !isReferenceKey(key))) return value;
      return inList ? DROP : isReferenceKey(key) ? null : NOT_VALID;
    case "enum": {
      const allowed = Object.values(def.entries as Record<string, unknown>);
      if (typeof value === "string" && allowed.includes(value)) return value;
      return inList ? DROP : NOT_VALID;
    }
    case "literal": {
      const allowed = def.values as unknown[];
      if (allowed.includes(value)) return value;
      return inList ? DROP : NOT_VALID;
    }
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return inList ? DROP : null;
    case "boolean":
      if (typeof value === "boolean") return value;
      return inList ? DROP : null;
    case "array": {
      if (!Array.isArray(value)) return inList ? DROP : [];
      return value.map((item) => conform(def.element as Schema, item, key, true)).filter((item) => item !== DROP);
    }
    case "object": {
      if (!isPlainObject(value) && inList) return DROP;
      const given = isPlainObject(value) ? value : {};
      const shape = def.shape as Record<string, Schema>;
      // Keys the object does not declare are kept only where the schema keeps them (a record's own
      // top level, looseObject); a plain object drops them when it parses, so they are dropped here too.
      // Otherwise a claim stored as { state: "yes" } would carry "yes" into the view.
      const catchall = (def.catchall as Schema | undefined)?._zod.def.type;
      const out: Record<string, unknown> = catchall && catchall !== "never" ? { ...given } : {};
      for (const [field, fieldSchema] of Object.entries(shape)) {
        const conformed = conform(fieldSchema, given[field], field, false);
        // In a list, an element whose required listed value or reference is not valid is left out.
        if (inList && isRequired(fieldSchema) && (conformed === NOT_VALID || conformed === null) && innerKind(fieldSchema) !== "string") return DROP;
        if (inList && isRequired(fieldSchema) && isReferenceKey(field) && conformed === null) return DROP;
        if (conformed === undefined) delete out[field];
        else out[field] = conformed;
      }
      return out;
    }
    case "record": {
      // An entry of the wrong kind (a lifecycle dimension that is not an object, or one whose state is
      // not valid) is kept as an entry whose every field is not valid, so a reader says so instead of
      // reading it as unknown. A record of the wrong kind has every listed key so: a lifecycle stored as
      // a number reads "Not a valid value" in every dimension, not "unknown".
      const invalidEntry = () => conform(def.valueType as Schema, {}, "", false);
      const keyDef = (def.keyType as Schema | undefined)?._zod.def;
      if (!isPlainObject(value)) {
        if (inList) return DROP;
        const keys = keyDef?.type === "enum" ? Object.values(keyDef.entries as Record<string, string>) : [];
        return Object.fromEntries(keys.map((k) => [k, invalidEntry()]));
      }
      const out: Record<string, unknown> = {};
      for (const [field, item] of Object.entries(value)) {
        const conformed = conform(def.valueType as Schema, item, field, true);
        out[field] = conformed === DROP ? invalidEntry() : conformed === undefined ? null : conformed;
      }
      return out;
    }
    default:
      // unknown, any, union and the like: nothing to conform to.
      return value;
  }
}

/** Whether a schema accepts null (looking through optional and default). */
function allowsNull(schema: Schema | null): boolean {
  let s = schema;
  while (s) {
    const def = s._zod.def;
    if (def.type === "nullable") return true;
    s = WRAPPERS.includes(def.type) ? (def.innerType as Schema) : null;
  }
  return false;
}

/**
 * Make the value at `path` (an issue the schema still reports once every value has the right kind) not
 * valid: a value that may be null becomes null; otherwise, inside a list element, the element is left
 * out (a quotation too short to be one, an id that does not look like an id); otherwise text becomes
 * "Not a valid value" (a reference null), a number or true/false null. True when something changed.
 *
 * A rule across the fields of an object (a lifecycle "yes" or a claim labelled "reported" with no
 * quotation, a founder acceptance with a basis no source can give) is left to the derivations: they
 * never count such a statement towards a standing and list it as an unverified claim, which says more
 * than "Not a valid value" would.
 */
function settleAt(root: Schema, holder: { root: unknown }, path: readonly PropertyKey[]): boolean {
  let schema: Schema | null = root;
  let parent: Record<PropertyKey, unknown> = holder as unknown as Record<PropertyKey, unknown>;
  let key: PropertyKey = "root";
  // The deepest list element the path runs through, to leave it out.
  let element: { list: unknown[]; index: number } | null = null;
  let field = "";
  for (const step of path) {
    const value = parent[key];
    const def: Def | null = schema ? unwrap(schema)._zod.def : null;
    if (Array.isArray(value) && typeof step === "number") {
      element = { list: value, index: step };
      schema = def?.type === "array" ? (def.element as Schema) : null;
    } else if (isPlainObject(value)) {
      schema = def?.type === "object" ? ((def.shape as Record<string, Schema>)[String(step)] ?? null) : def?.type === "record" ? (def.valueType as Schema) : null;
      if (typeof step === "string") field = step;
    } else {
      return false;
    }
    parent = value as Record<PropertyKey, unknown>;
    key = step;
  }
  const value = parent[key];
  if (value === undefined || value === null || value === NOT_VALID || value === DROP || typeof value === "object") return false;
  if (allowsNull(schema) && !(element && parent === (element.list as unknown))) {
    parent[key] = null;
    return true;
  }
  if (element) {
    if (element.list[element.index] === DROP) return false;
    element.list[element.index] = DROP;
    return true;
  }
  parent[key] = typeof value === "string" && !isReferenceKey(field) ? NOT_VALID : null;
  return true;
}

/** Remove the elements settleAt left out, at any depth. */
function sweep(value: unknown): void {
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i--) {
      if (value[i] === DROP) value.splice(i, 1);
      else sweep(value[i]);
    }
  } else if (isPlainObject(value)) {
    for (const child of Object.values(value)) sweep(child);
  }
}

/** A record's data conformed to its schema. A valid record comes back as it is (the same object). */
export function conformRecord(type: RecordType, data: unknown): AnyRecord {
  if (safeParseRecord(type, data).ok) return data as AnyRecord;
  const schema = RECORD_SCHEMAS[type] as unknown as Schema;
  const holder = { root: conform(schema, data, "", false) ?? {} };
  // A few rounds: a value made null can break the rule of the field around it.
  for (let round = 0; round < 4; round++) {
    const result = RECORD_SCHEMAS[type].safeParse(holder.root);
    if (result.success) break;
    let changed = false;
    for (const issue of result.error.issues) changed = settleAt(schema, holder, issue.path) || changed;
    sweep(holder.root);
    if (!changed) break;
  }
  return holder.root as AnyRecord;
}

const views = new WeakMap<Dataset, DatasetView>();

/**
 * ROUND4 H6a: an envelope of the view says whether its record passes validation. A conformed record's
 * meta carries `valid: false`; every other envelope is the one the store loaded, with no such mark.
 */
export type ViewMeta = RecordMeta & { readonly valid?: false };

/**
 * Whether a record of the view passes validation. The one test every derivation uses before it counts a
 * record as proof of anything (an acceptance, a test, a check, a link that resolves something): a record
 * HQ cannot read in full counts for nothing positive, wherever it is (H6a).
 */
export function isReadable(envelope: { meta: RecordMeta }): boolean {
  return (envelope.meta as ViewMeta).valid !== false;
}

/** A record that fails validation, as the view lists it. */
export interface UnreadableRef {
  type: RecordType;
  id: string;
}

interface ViewInfo {
  /** Every record that fails validation, in the dataset's order. */
  all: UnreadableRef[];
  /** For each module id, the records that fail validation and name it anywhere in their stored data (itself included). */
  byModule: Map<string, UnreadableRef[]>;
  /** Each failing record's data exactly as stored, keyed "type:id". */
  stored: Map<string, unknown>;
  /** L8: for each failing record ("type:id"), the fields whose list conforming emptied, as paths ("blocked_by", "statement.citations"). */
  emptied: Map<string, string[]>;
}

/**
 * Where a view keeps its ViewInfo: on the view itself, under a key from the global symbol registry, not in
 * a module's own map. A production build can load this module more than once (a page's bundle and an API
 * route's), while the store's cache of loaded datasets is shared by all of them, so a module-local map
 * filled by one copy would be empty for another.
 */
const INFO = Symbol.for("harmonybyrd-hq.conform.view-info");
const EMPTY_INFO: ViewInfo = { all: [], byModule: new Map(), stored: new Map(), emptied: new Map() };
const infoOf = (view: DatasetView): ViewInfo => (view as unknown as { [INFO]?: ViewInfo })[INFO] ?? EMPTY_INFO;

/** A character that can be part of an id next to another: a letter, digit, hyphen or underscore. */
const ID_CHAR = /[A-Za-z0-9_-]/;

/** Whether `id` occurs in `text` on its own: not as part of a longer id ("MOD-A" is not in "MOD-A-2"). */
function occursIn(text: string, id: string): boolean {
  if (!id) return false;
  for (let at = text.indexOf(id); at >= 0; at = text.indexOf(id, at + 1)) {
    const before = at === 0 ? "" : text[at - 1];
    const after = text[at + id.length] ?? "";
    if (!ID_CHAR.test(before) && !ID_CHAR.test(after)) return true;
  }
  return false;
}

/**
 * Every module id that occurs as a string anywhere in a stored value (H6b): in a text or an object key, at
 * any depth, whole or standing on its own inside a longer text ("MOD-A, MOD-B", "see MOD-A."). Stored values
 * are read as they are: this is what the record names, whatever kind its fields are.
 */
function modulesNamed(value: unknown, moduleIds: readonly string[], out: Set<string>): void {
  const text = (s: string) => {
    for (const id of moduleIds) if (!out.has(id) && s.length >= id.length && occursIn(s, id)) out.add(id);
  };
  // Iterative, so a deeply nested stored value cannot exhaust the stack.
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string") text(v);
    else if (Array.isArray(v)) for (const item of v) stack.push(item);
    else if (isPlainObject(v)) {
      for (const [k, child] of Object.entries(v)) {
        text(k);
        stack.push(child);
      }
    }
  }
}

/**
 * L8: the places where conforming left an empty list although the stored value there is something else
 * (a text, a number, a list whose every element was of the wrong kind): a list HQ cannot read, not a
 * list that holds nothing. Walks the conformed record's objects (not into list elements, whose
 * positions conforming may have shifted), as dot paths in the record's own key order. A field that was
 * missing, or stored as an empty list, is not among them: nothing was stored there.
 */
function emptiedLists(stored: unknown, conformed: unknown, path = "", out: string[] = []): string[] {
  if (!isPlainObject(conformed)) return out;
  const given = isPlainObject(stored) ? stored : {};
  for (const [key, value] of Object.entries(conformed)) {
    const at = path ? `${path}.${key}` : key;
    const was = given[key];
    if (Array.isArray(value)) {
      if (value.length === 0 && was !== undefined && !(Array.isArray(was) && was.length === 0)) out.push(at);
    } else if (isPlainObject(value)) {
      emptiedLists(was, value, at, out);
    }
  }
  return out;
}

/**
 * L8: the fields of a record of the view whose list is empty only because conforming emptied it (see
 * emptiedLists). Empty for a record that passes validation. A screen shows each as UNREADABLE_LIST, and an
 * API answer for the record carries UNREADABLE_LIST beside it, never "nothing".
 */
export function unreadableFields(view: DatasetView, envelope: { meta: RecordMeta }): readonly string[] {
  return infoOf(view).emptied.get(`${envelope.meta.type}:${envelope.meta.id}`) ?? [];
}

/** L8: the same, as the API gives it beside the record: each such field with UNREADABLE_LIST. Null when there is none. */
export function unreadableFieldNotes(view: DatasetView, envelope: { meta: RecordMeta }): Record<string, string> | null {
  const fields = unreadableFields(view, envelope);
  return fields.length ? Object.fromEntries(fields.map((f) => [f, UNREADABLE_LIST])) : null;
}

/** The records of a view that fail validation (H6b). Empty when every record is valid. */
export function unreadableRecords(view: DatasetView): readonly UnreadableRef[] {
  return infoOf(view).all;
}

/**
 * The records that fail validation and name this module anywhere in their stored data, the module itself
 * included when it is one of them (H6b). Its figures may be incomplete by what these hold.
 */
export function unreadableNaming(view: DatasetView, moduleId: string): readonly UnreadableRef[] {
  return infoOf(view).byModule.get(moduleId) ?? [];
}

/** A record's data exactly as stored, for a record of the view that fails validation; undefined for any other. */
export function storedDataOf(view: DatasetView, envelope: { meta: RecordMeta }): unknown {
  return infoOf(view).stored.get(`${envelope.meta.type}:${envelope.meta.id}`);
}

/**
 * The dataset with every record listed in `invalid` (the store's integrity warnings) conformed and every
 * other record as loaded. Without `invalid`, each record is checked here (for a dataset built outside the
 * store, as the tests build theirs). Worked out once per dataset. When every record is valid, the view is
 * the dataset itself.
 *
 * A conformed record's meta says `valid: false` (isReadable). The view also keeps, for the warnings, which
 * modules each failing record names in its stored data, and that stored data (H6b).
 */
export function conformDataset(ds: Dataset, invalid?: readonly { type: string; id: string }[]): DatasetView {
  const cached = views.get(ds);
  if (cached) return cached;
  const failing = invalid ?? ds.all().filter((e) => !safeParseRecord(e.meta.type, e.data).ok).map((e) => e.meta);
  if (failing.length === 0) {
    const same = ds as DatasetView;
    views.set(ds, same);
    return same;
  }
  const flagged = new Set(failing.map((w) => `${w.type}:${w.id}`));
  const moduleIds = ds.records.module.map((m) => m.meta.id);
  const info: ViewInfo = { all: [], byModule: new Map(), stored: new Map(), emptied: new Map() };
  const envelopes: Envelope<AnyRecord>[] = ds.all().map((envelope) => {
    const key = `${envelope.meta.type}:${envelope.meta.id}`;
    if (!flagged.has(key)) return envelope;
    const ref: UnreadableRef = { type: envelope.meta.type, id: envelope.meta.id };
    info.all.push(ref);
    info.stored.set(key, envelope.data);
    const named = new Set<string>();
    if (envelope.meta.type === "module") named.add(envelope.meta.id);
    modulesNamed(envelope.data, moduleIds, named);
    for (const moduleId of named) info.byModule.set(moduleId, [...(info.byModule.get(moduleId) ?? []), ref]);
    // The record's id is the one it is stored under, whatever its data says in its place.
    const data = conformRecord(envelope.meta.type, envelope.data) as AnyRecord & { id: unknown };
    const emptied = emptiedLists(envelope.data, data);
    if (emptied.length) info.emptied.set(key, emptied);
    const meta: ViewMeta = { ...envelope.meta, valid: false };
    return { meta, data: { ...data, id: envelope.meta.id } as AnyRecord };
  });
  const view = new Dataset(ds.revision, envelopes) as DatasetView;
  Object.defineProperty(view, INFO, { value: info, enumerable: false });
  views.set(ds, view);
  return view;
}
