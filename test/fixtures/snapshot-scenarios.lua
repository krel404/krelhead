local handler = Frames[1].handler
handler(nil, "PLAYER_LOGIN")
handler(nil, "PLAYER_EQUIPMENT_CHANGED")
assert(#Timers == 1, "events should debounce")
FlushTimers()
assert(TomeSnapshotExport and TomeSnapshotExport:sub(1, 6) == "TOME1:", "login should capture")
TestBaseline = TomeSnapshotExport
Combat = true; Now = Now + 1
handler(nil, "PLAYER_EQUIPMENT_CHANGED"); FlushTimers()
assert(TomeSnapshotExport == TestBaseline, "combat must preserve saved data")
Combat = false; ItemReady = false
handler(nil, "PLAYER_REGEN_ENABLED"); FlushTimers()
TestCacheMiss = TomeSnapshotExport
Staged = true; Now = Now + 1
handler(nil, "TRAIT_CONFIG_UPDATED"); FlushTimers()
TestStaged = TomeSnapshotExport
Staged = false; ClassAPIReady = false; Now = Now + 1
handler(nil, "TRAIT_CONFIG_UPDATED"); FlushTimers()
TestMissingTalents = TomeSnapshotExport
ClassAPIReady = true; Equipped = false; Now = Now + 1
handler(nil, "PLAYER_LOGOUT")
TestUnequipped = TomeSnapshotExport
local saved = TomeSnapshotExport
GetInventoryItemID = function() error("restricted game value") end
handler(nil, "PLAYER_EQUIPMENT_CHANGED"); FlushTimers()
assert(TomeSnapshotExport == saved, "restricted API must preserve previous capture")
GetBuildInfo = function() return "12.0", "1", "date", 120000 end
handler(nil, "PLAYER_LOGIN"); FlushTimers()
assert(TomeSnapshotExport == saved, "must not capture Retail as Forever")
