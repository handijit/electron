// The update button and the required-update gate, drawn with @handijitcom/ui. The page also
// imports "@handijitcom/electron/styles.css".
import DEFAULT_UPDATE_LABELS from "./update-ui/labels.constants";
import type { UpdateLabels } from "./update-ui/labels.constants";
import UpdateButton from "./update-ui/update-button";
import type { UpdateButtonProps } from "./update-ui/update-button";
import UpdateGate from "./update-ui/update-gate";
import type { UpdateGateProps } from "./update-ui/update-gate";

export { DEFAULT_UPDATE_LABELS, UpdateButton, UpdateGate };
export type { UpdateButtonProps, UpdateGateProps, UpdateLabels };
