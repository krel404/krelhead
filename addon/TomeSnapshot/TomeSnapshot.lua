local ADDON_VERSION = "0.3.0"
local arrayMarker = {}
local function array() return setmetatable({}, arrayMarker) end
local function quote(value)
    return '"' .. value:gsub('[%z\1-\31\\"]', function(c)
        return string.format("\\u%04x", string.byte(c))
    end) .. '"'
end
local function json(value)
    if type(value) == "string" then return quote(value) end
    if type(value) == "number" then return tostring(value) end
    if type(value) == "boolean" then return value and "true" or "false" end
    if type(value) ~= "table" then error("Unsupported snapshot value") end
    local parts = {}
    if getmetatable(value) == arrayMarker then
        for _, item in ipairs(value) do parts[#parts + 1] = json(item) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    local keys = {}
    for key in pairs(value) do keys[#keys + 1] = key end
    table.sort(keys)
    for _, key in ipairs(keys) do parts[#parts + 1] = quote(key) .. ":" .. json(value[key]) end
    return "{" .. table.concat(parts, ",") .. "}"
end
local function encode(value)
    return "TOME1:" .. json(value):gsub(".", function(c) return string.format("%02x", string.byte(c)) end)
end
local function say(text) DEFAULT_CHAT_FRAME:AddMessage("|cffb58cffTome:|r " .. text) end
local lastSnapshot, queued, retryItems = nil, false, false

local function equipmentSnapshot()
    local equipment = array()
    retryItems = false
    for slot = 1, 19 do
        local item = { slot = slot, status = "unavailable" }
        local id = GetInventoryItemID("player", slot)
        if id then
            item.status, item.itemId = "equipped", id
            local link = GetInventoryItemLink("player", slot)
            if link then
                item.itemString = link:match("|H(item:[^|]+)|h")
                item.name = link:match("|h%[(.-)%]|h")
            end
            if not item.itemString then
                retryItems = true
                local previous = lastSnapshot and lastSnapshot.equipment[slot]
                if previous and previous.itemId == id then
                    item.itemString, item.name = previous.itemString, previous.name
                end
                if C_Item and C_Item.RequestLoadItemDataByID then C_Item.RequestLoadItemDataByID(id) end
            end
        elseif C_Item and C_Item.DoesItemExist and ItemLocation and ItemLocation.CreateFromEquipmentSlot then
            if not C_Item.DoesItemExist(ItemLocation:CreateFromEquipmentSlot(slot)) then item.status = "empty" end
        end
        equipment[#equipment + 1] = item
    end
    return equipment
end

local function talentSnapshot()
    if not C_Traits or not C_ClassTalents then error("Talent API unavailable") end
    local configId
    if C_SpecializationInfo and C_SpecializationInfo.GetActiveSpecGroup and C_SpecializationInfo.GetCombatConfigIDForSpecGroup then
        configId = C_SpecializationInfo.GetCombatConfigIDForSpecGroup(C_SpecializationInfo.GetActiveSpecGroup())
    end
    configId = configId or C_ClassTalents.GetActiveConfigID()
    if not configId then error("Talents not loaded") end
    -- Do not publish previewed changes as learned talents.
    if not C_Traits.ConfigHasStagedChanges then error("Cannot verify committed talents") end
    if C_Traits.ConfigHasStagedChanges(configId) then return { status = "pending", configId = configId, nodes = array() } end
    local config = C_Traits.GetConfigInfo(configId)
    if not config or not config.treeIDs or #config.treeIDs == 0 then error("Talent trees not loaded") end
    local nodes, seen = array(), {}
    for _, treeId in ipairs(config.treeIDs) do
        local ids = C_Traits.GetTreeNodes(treeId)
        if not ids or #ids == 0 then error("Talent nodes not loaded") end
        for _, nodeId in ipairs(ids) do
            local node = C_Traits.GetNodeInfo(configId, nodeId)
            if not node then error("Talent node unavailable") end
            if node.activeRank and node.activeRank > 0 and not seen[nodeId] then
                seen[nodeId] = true
                local entryId = node.activeEntry and node.activeEntry.entryID
                if not entryId then error("Selected talent entry unavailable") end
                local entry = C_Traits.GetEntryInfo(configId, entryId)
                if not entry or not entry.definitionID then error("Talent definition unavailable") end
                local definition = C_Traits.GetDefinitionInfo(entry.definitionID)
                if not definition then error("Talent definition not loaded") end
                local spellId = definition.spellID
                local name = definition.overrideName
                if not name and spellId and C_Spell and C_Spell.GetSpellName then name = C_Spell.GetSpellName(spellId) end
                nodes[#nodes + 1] = { treeId = treeId, nodeId = nodeId, entryId = entryId,
                    rank = node.activeRank, spellId = spellId, name = name }
            end
        end
    end
    table.sort(nodes, function(a, b) return a.nodeId < b.nodeId end)
    return { status = "complete", configId = configId, nodes = nodes }
end

local function collect()
    if InCombatLockdown() then error("Wait until combat ends") end
    local version, build, _, interface = GetBuildInfo()
    if not interface or interface < 16000 or interface >= 17000 then error("This addon supports WoW Forever only") end
    local name, surname = UnitName("player") -- Forever's second value is a surname, NOT a realm.
    local guid, level = UnitGUID("player"), UnitLevel("player")
    if not name or not guid or not level or level < 1 then error("Character not loaded") end
    local _, classToken = UnitClass("player")
    local _, raceToken = UnitRace("player")
    if not classToken or not raceToken then error("Character data unavailable") end
    local talentOK, talents = pcall(talentSnapshot)
    if not talentOK then talents = { status = "unavailable", nodes = array() } end
    return { schemaVersion = 1, addonVersion = ADDON_VERSION, capturedAt = GetServerTime(),
        game = { version = version, build = build, interface = interface, region = GetCurrentRegion() },
        character = { guid = guid, name = name, surname = surname or "", realm = GetRealmName(),
            classToken = classToken, raceToken = raceToken, faction = UnitFactionGroup("player"), level = level },
        equipment = equipmentSnapshot(), talents = talents }
end
local function capture()
    -- Secret/restricted values or a transient API failure must never destroy the last good export.
    local ok, snapshot, payload = pcall(function()
        local value = collect()
        return value, encode(value)
    end)
    if ok then lastSnapshot, TomeSnapshotExport = snapshot, payload end
    return ok
end
local function schedule()
    if queued then return end
    queued = true
    C_Timer.After(3, function() queued = false; capture() end)
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "PLAYER_EQUIPMENT_CHANGED", "UNIT_INVENTORY_CHANGED",
    "PLAYER_LEVEL_UP", "TRAIT_CONFIG_UPDATED", "TRAIT_CONFIG_LIST_UPDATED", "PLAYER_SPECIALIZATION_CHANGED",
    "PLAYER_REGEN_ENABLED", "GET_ITEM_INFO_RECEIVED", "ITEM_DATA_LOAD_RESULT", "PLAYER_LOGOUT" }) do
    pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event, unit)
    if event == "PLAYER_LOGOUT" then capture(); return end
    if event == "UNIT_INVENTORY_CHANGED" and unit ~= "player" then return end
    if (event == "GET_ITEM_INFO_RECEIVED" or event == "ITEM_DATA_LOAD_RESULT") and not retryItems then return end
    schedule()
end)

local exportWindow
local function showExport()
    if not exportWindow then
        local window = CreateFrame("Frame", "TomeSnapshotExportWindow", UIParent, "BackdropTemplate")
        window:SetSize(540, 340); window:SetPoint("CENTER"); window:SetFrameStrata("DIALOG")
        window:SetBackdrop({ bgFile = "Interface/Tooltips/UI-Tooltip-Background", edgeFile = "Interface/Tooltips/UI-Tooltip-Border", tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
        window:SetBackdropColor(0.06, 0.03, 0.1, 1)
        local title = window:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
        title:SetPoint("TOPLEFT", 18, -18); title:SetText("Tome character snapshot")
        local help = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
        help:SetPoint("TOPLEFT", 18, -48); help:SetWidth(500); help:SetJustifyH("LEFT")
        help:SetText("Copy this text into a .txt file, then use /character import in Discord.\nYour level, equipment and talents will be shared with that server.")
        local close = CreateFrame("Button", nil, window, "UIPanelCloseButton"); close:SetPoint("TOPRIGHT")
        local scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
        scroll:SetPoint("TOPLEFT", 18, -90); scroll:SetPoint("BOTTOMRIGHT", -35, 18)
        local edit = CreateFrame("EditBox", nil, scroll)
        edit:SetMultiLine(true); edit:SetFontObject(ChatFontNormal); edit:SetWidth(475); edit:SetAutoFocus(false)
        edit:SetScript("OnEscapePressed", function() window:Hide() end)
        scroll:SetScrollChild(edit); window.edit = edit; exportWindow = window
    end
    exportWindow:Show(); exportWindow.edit:SetText(TomeSnapshotExport); exportWindow.edit:SetFocus(); exportWindow.edit:HighlightText()
end
SLASH_TOMESNAPSHOT1 = "/tomesnapshot"
SlashCmdList.TOMESNAPSHOT = function(command)
    if command == "status" then
        say(lastSnapshot and ("Captured " .. date("%Y-%m-%d %H:%M:%S", lastSnapshot.capturedAt) .. ". Talents: " .. lastSnapshot.talents.status .. ".") or "No snapshot captured in this session yet.")
        return
    end
    if not capture() then say("Could not capture now. Leave combat, wait for your character to load, and try again. Previous saved data is unchanged."); return end
    if command == "capture" then
        say("Captured level, gear and talents. Type /reload or log out to write the file for your uploader. Nothing is uploaded by this addon.")
    else showExport() end
end
