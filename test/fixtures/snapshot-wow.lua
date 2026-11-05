-- Minimal Forever API doubles; these are not a substitute for testing in the live game.
Frames, Timers, SlashCmdList = {}, {}, {}
DEFAULT_CHAT_FRAME = { AddMessage = function() end }
C_Timer = { After = function(_, callback) Timers[#Timers + 1] = callback end }
function CreateFrame()
    local frame = { RegisterEvent = function() end, SetScript = function(self, _, callback) self.handler = callback end }
    Frames[#Frames + 1] = frame
    return frame
end
Now, Combat, Staged, ItemReady, Equipped, ClassAPIReady = 1700000000, false, false, true, true, true
function InCombatLockdown() return Combat end
function GetBuildInfo() return "1.60.1", "70755", "Nov 3 2026", 16001 end
function GetServerTime() return Now end
function GetCurrentRegion() return 3 end
function UnitName() return "Test", "Surname" end
function UnitGUID() return "Player-1234-ABCDEF" end
function UnitLevel() return 25 end
function UnitClass() return "Rogue", "ROGUE" end
function UnitRace() return "Orc", "Orc" end
function UnitFactionGroup() return "Horde" end
function GetRealmName() return "Forever PvP" end
function GetInventoryItemID(_, slot) if Equipped and slot == 16 then return 12345 end end
function GetInventoryItemLink(_, slot) if ItemReady and Equipped and slot == 16 then return "|cffabcdef|Hitem:12345:15:0:0:0:0:-9:42|h[Test Blade]|h|r" end end
ItemLocation = { CreateFromEquipmentSlot = function(_, slot) return slot end }
C_Item = { DoesItemExist = function(slot) return Equipped and slot == 16 end, RequestLoadItemDataByID = function() end }
C_SpecializationInfo = { GetActiveSpecGroup = function() return 1 end, GetCombatConfigIDForSpecGroup = function() if ClassAPIReady then return 123 end end }
C_ClassTalents = { GetActiveConfigID = function() if ClassAPIReady then return 123 end end }
C_Traits = {
    ConfigHasStagedChanges = function() return Staged end,
    GetConfigInfo = function() return { treeIDs = {1117} } end,
    GetTreeNodes = function() return { 105320, 105321 } end,
    GetNodeInfo = function(_, node) return { activeRank = node == 105320 and 3 or 0, activeEntry = { entryID = 765 } } end,
    GetEntryInfo = function() return { definitionID = 789 } end,
    GetDefinitionInfo = function() return { spellID = 14162 } end,
}
C_Spell = { GetSpellName = function() return "Test Talent" end }
function FlushTimers()
    local pending = Timers; Timers = {}
    for _, callback in ipairs(pending) do callback() end
end
