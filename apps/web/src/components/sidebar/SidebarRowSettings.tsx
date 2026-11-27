import type { SidebarRowDetailPlacement } from "@t3tools/contracts/settings";
import { T, useGT, useMessages, Var } from "gt-react";
import { ChevronDownIcon } from "lucide-react";

import {
  getClientSettings,
  updateClientSettings,
  useClientSettings,
} from "../../hooks/useSettings";
import { SettingResetButton, SettingsRow } from "../settings/settingsLayout";
import { useSearchableSetting } from "../settings/settingsSearch";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  isDefaultSidebarRowPlacements,
  resolveSidebarRowPlacements,
  setSidebarRowDetail,
  SIDEBAR_ROW_DETAILS,
  sidebarRowPlacementChoices,
} from "./sidebarRowDetails";

/** Project Board fork: Settings → Sidebar, the chat rows' style and where each detail shows. */
export function SidebarRowSettings() {
  const gt = useGT();
  const m = useMessages();
  const setting = useSearchableSetting();
  const style = useClientSettings((settings) => settings.sidebarRowStyle);
  const placements = useClientSettings(resolveSidebarRowPlacements);
  const placementLabel: Record<SidebarRowDetailPlacement, string> = {
    row: gt("In the row"),
    allBoards: gt("In the row while All boards is on"),
    card: gt("On the hover card"),
    hidden: gt("Hidden"),
  };
  const inRow = SIDEBAR_ROW_DETAILS.filter(
    (detail) => placements[detail.id] === "row" || placements[detail.id] === "allBoards",
  ).length;
  return (
    <>
      <SettingsRow
        {...setting("sidebar-row-style")}
        description={
          <T>
            Compact rows take one line and show the rest on the hover card. Classic rows are the
            three-line cards.
          </T>
        }
        resetAction={
          style === "compact" ? null : (
            <SettingResetButton
              ariaLabel={gt("Reset chat rows to default")}
              onClick={() => updateClientSettings({ sidebarRowStyle: "compact" })}
            />
          )
        }
        control={
          <Select
            value={style}
            onValueChange={(value) => {
              if (value === "compact" || value === "classic") {
                updateClientSettings({ sidebarRowStyle: value });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={gt("Chat rows")}>
              <SelectValue>{style === "compact" ? gt("Compact") : gt("Classic")}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="compact">
                {gt("Compact")}
              </SelectItem>
              <SelectItem hideIndicator value="classic">
                {gt("Classic")}
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
      {style === "compact" ? (
        <SettingsRow
          {...setting("sidebar-row-details")}
          description={
            <T>
              Choose which details a compact row shows, which wait on its hover card, and which are
              hidden.
            </T>
          }
          resetAction={
            isDefaultSidebarRowPlacements(placements) ? null : (
              <SettingResetButton
                ariaLabel={gt("Reset row details to default")}
                onClick={() => updateClientSettings({ sidebarRowDetails: {} })}
              />
            )
          }
          control={
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between sm:w-44"
                    aria-label={gt("Row details: {count} in the row", { count: inRow })}
                  />
                }
              >
                <T>
                  <Var>{inRow}</Var> in the row
                </T>
                <ChevronDownIcon aria-hidden />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuGroup>
                  <MenuGroupLabel>
                    <T>Where each detail shows</T>
                  </MenuGroupLabel>
                  {SIDEBAR_ROW_DETAILS.map((detail) => (
                    <MenuSub key={detail.id}>
                      <MenuSubTrigger>
                        {m(detail.label)}
                        <MenuItemDetail>{placementLabel[placements[detail.id]]}</MenuItemDetail>
                      </MenuSubTrigger>
                      <MenuSubPopup>
                        <MenuRadioGroup
                          value={placements[detail.id]}
                          onValueChange={(value: SidebarRowDetailPlacement) =>
                            updateClientSettings({
                              sidebarRowDetails: setSidebarRowDetail(
                                getClientSettings(),
                                detail,
                                value,
                              ),
                            })
                          }
                        >
                          {sidebarRowPlacementChoices(detail.id).map((placement) => (
                            <MenuRadioItem key={placement} value={placement}>
                              <span className="flex items-center justify-between gap-3">
                                {placementLabel[placement]}
                                <MenuRadioItemIndicator />
                              </span>
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuSubPopup>
                    </MenuSub>
                  ))}
                </MenuGroup>
                <MenuSeparator />
                <MenuItem
                  disabled={isDefaultSidebarRowPlacements(placements)}
                  onClick={() => updateClientSettings({ sidebarRowDetails: {} })}
                >
                  <T>Reset to default</T>
                </MenuItem>
              </MenuPopup>
            </Menu>
          }
        />
      ) : null}
    </>
  );
}
