import { CORE_CHANNEL_PREFIX } from "./core-channels.constants";

// `area:action`, both parts kebab-case. Linear: no nested quantifier over the same characters.
const CHANNEL_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Whether a string is a well-formed `area:action` channel name. */
const isChannelName = (name: string): boolean => CHANNEL_PATTERN.test(name);

/**
 * Collects the channel names of a contract (or a channel map) and rejects the ones that would
 * be unsafe to register: malformed names, the reserved `core-` area, and a name used both as
 * a request and as an event.
 */
const collectChannels = (
  source: {
    readonly invoke: Readonly<Record<string, unknown>>;
    readonly events: Readonly<Record<string, unknown>>;
  },
  caller: string
): { invoke: string[]; events: string[] } => {
  const invoke = Object.keys(source.invoke);
  const events = Object.keys(source.events);

  for (const name of [...invoke, ...events]) {
    if (!isChannelName(name)) {
      throw new TypeError(
        `${caller}: channel "${name}" must be "area:action" in kebab-case, like "settings:set-theme"`
      );
    }
    if (name.startsWith(CORE_CHANNEL_PREFIX)) {
      throw new TypeError(
        `${caller}: channel "${name}" uses the "${CORE_CHANNEL_PREFIX}" area, which is reserved for @handijit/electron`
      );
    }
  }

  const duplicate = events.find((name) => Object.hasOwn(source.invoke, name));
  if (duplicate !== undefined) {
    throw new TypeError(
      `${caller}: channel "${duplicate}" is declared both as a request and as an event`
    );
  }

  return { invoke, events };
};

export { collectChannels, isChannelName };
