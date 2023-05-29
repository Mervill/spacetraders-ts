import axios from 'axios'
import * as _ from "lodash"
import * as dotenv from "dotenv"
import * as MapRender from "./src/MapRenderer"
import * as utils from "./utils"
import {
  Cooldown,
  ShipNav,
  ShipNavRoute,
  Ship,
  ScannedShip,
  ShipNavStatus,
  NavigateShipRequest,
  ShipFuel,
  Extraction,
  SellCargoRequest,
  ShipCargo,
  MarketTransaction,
  SellCargo201ResponseData,
  Waypoint,
  WaypointTraitSymbolEnum,
  WaypointType,
  System,
} from './packages/spacetraders-sdk'
import * as fs from 'fs'
import { AgentRecord } from './src/types'
import { STContext } from './src/STContext'
import { TaskManager } from './src/TaskManager'

// FLIGHT MODE
// DRIFT, STEALTH, CRUISE, BURN
// DR     ST       CR      BU
//
// STATUS
// IN_TRANSIT, IN_ORBIT, DOCKED
// TR          OR        DO

dotenv.config();

const axoisInstance = axios.create({})

//axoisInstance.interceptors.request.

// example retry logic for 429 rate-limit errors
axoisInstance.interceptors.response.use(undefined, async (error) => {
    //const apiError = error.response?.data?.error
    if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after']
        console.warn(`GOT ERROR 429 rate-limit, retry after ${retryAfter}s`)
        await new Promise((resolve) => {
            setTimeout(resolve, (retryAfter * 1000) + (Math.random() * 1000))
        })
        return axoisInstance.request(error.config)
    }
    throw error
})

axoisInstance.interceptors.response.use(undefined, async (error) => {
    if ((error.response?.status === 409 || error.response?.status === 400 || error.response?.status === 422) && error.response.data !== undefined) {
        console.error(error.request.path)
        console.error(JSON.stringify(error.response.data, undefined, 2))
    }
    throw error
})

let context: STContext = new STContext(axoisInstance)

let SeenAgents: AgentRecord[] = []

function DefaultOnRejected(reason: any) {
    console.log("!!!!! REQUEST REJECTED !!!!!")
    console.log(JSON.stringify(reason, undefined, 2))
}

function SplitLocationSymbol(rawLocation: string) {
    const parts: string[] = rawLocation.split('-')
    const sectorPart: string = parts[0]
    const systemPart: string = parts[1]
    const waypointPart: string = parts[2]
    return { Sector: sectorPart, System: systemPart, Waypoint: waypointPart }
}

function CalcShipRouteTimeRemaining(route: ShipNavRoute): number {
    let nowDate = new Date()
    let depatureDate = new Date(route.departureTime)
    let arrivalDate = new Date(route.arrival)
    let timeRemaining = arrivalDate.getTime() - nowDate.getTime()
    return timeRemaining
}

// MillisecondsToDuration
// MillisecToDuration
function msToHMS(ms: number): string {
    // convert to seconds
    let seconds = Math.floor(ms / 1000);

    const hours = Math.floor(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours

    const minutes = Math.floor(seconds / 60); // 60 seconds in 1 minute
    seconds = seconds % 60; // seconds remaining after extracting minutes

    const hrs: string = hours.toString().padStart(2,"0")
    const mins: string = minutes.toString().padStart(2,"0")
    const secs: string = seconds.toString().padStart(2,"0")
    const msecs: string = (ms % 1000).toString().padStart(4, "0")

    return `${hrs}:${mins}:${secs}.${msecs}`;
}

function msToDHMS(ms: number): string {
    // convert to seconds
    let seconds = Math.floor(ms / 1000);

    const days = Math.floor(seconds / 86400)
    seconds = seconds % 86400

    const hours = Math.floor(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours

    const minutes = Math.floor(seconds / 60); // 60 seconds in 1 minute
    seconds = seconds % 60; // seconds remaining after extracting minutes

    const hrs: string = hours.toString().padStart(2,"0")
    const mins: string = minutes.toString().padStart(2,"0")
    const secs: string = seconds.toString().padStart(2,"0")
    const msecs: string = (ms % 1000).toString().padStart(4, "0")

    return `${days}:${hrs}:${mins}:${secs}.${msecs}`;
}

function WaitForMS(timeMS: number): Promise<never> {
    return new Promise<never>((resolve) => {
        setTimeout(resolve, timeMS)
    })
}

async function WaitForTransit(route: ShipNav) {

}

async function WaitForCooldown(cooldown: Cooldown, log: boolean = true) {
    // todo: make sure cooldown is actually in the future?
    let now: Date = new Date()
    let expiration: Date = new Date(cooldown.expiration)
    let timeLefMS = expiration.getTime() - now.getTime()
    if (log) {
        console.log(`${cooldown.shipSymbol}/cooldown: Currently in cooldown, expiry ${msToHMS(timeLefMS)}`)    
    }
    await WaitForMS(timeLefMS)
}

async function WaitForShipIdle(shipSymbol: string) {
    console.log(`${shipSymbol}/waitIdle: Waiting until ship is idle`)

    let navigationResponse = await context.fleetApi.getShipNav(shipSymbol)
    let nav: ShipNav = navigationResponse.data.data
    if (nav.status == ShipNavStatus.InTransit) {
        let now = new Date()
        let waitfor = (new Date(nav.route.arrival)).getTime() - (now).getTime()
        console.log(`${shipSymbol}/waitIdle: Waiting on transit, complete in ${msToHMS(waitfor)}`)
        await WaitForMS(waitfor)
    } else {
        let cooldownResponse = await context.fleetApi.getShipCooldown(shipSymbol)
        if (cooldownResponse.status == 200) {
            let cooldown: Cooldown = cooldownResponse.data.data
            await WaitForCooldown(cooldown)
        }
    }

    console.log(`${shipSymbol}/waitIdle: Ship is idle`)
}

/*async function WaitForIdle(myShip: Ship) {
    let nav = myShip.nav
    if (nav.status == ShipNavStatus.InTransit) {
        let now = new Date()
        let waitfor = (new Date(nav.route.arrival)).getTime() - (now).getTime()
        console.log(`${myShip.symbol}/waitIdle: waiting on transit, complete in ${msToHMS(waitfor)}`)
        await WaitForMS(waitfor)
    } else {
        let cooldownResponse = await fleet.getShipCooldown(myShip.symbol)
        if (cooldownResponse.status == 200) {
            let cooldown: Cooldown = cooldownResponse.data.data
            await WaitForCooldown(cooldown)
        }
    }
    console.log(`${myShip.symbol}/waitIdle: ship is idle`)
}*/

async function DoNavigateTo(myShip: Ship, destinationWaypoint: string) {

    const logPrefix: string = `${myShip.symbol}/nav`

    if (myShip.nav.waypointSymbol == destinationWaypoint) {
        console.log(`${logPrefix}: not navigating, already at destination waypoint!`)
        return
    }

    let navigateRequest: NavigateShipRequest = { waypointSymbol: destinationWaypoint }
    let navigateResponse = await context.fleetApi.navigateShip(myShip.symbol, navigateRequest);

    myShip.fuel = navigateResponse.data.data.fuel
    myShip.nav = navigateResponse.data.data.nav

    let totalDeltaTime: number = (new Date(myShip.nav.route.arrival)).getTime() - (new Date(myShip.nav.route.departureTime)).getTime()

    console.log(`${logPrefix}: Navigating to ${myShip.nav.route.destination.symbol} ${myShip.nav.route.destination.type}`)
    console.log(`${logPrefix}: Flight time is ${msToHMS(totalDeltaTime)}`) //${totalDeltaTime}
    console.log(`${logPrefix}: Flight consum(ed/ing) ${myShip.fuel.consumed.amount} fuel. Fuel: ${myShip.fuel.current}/${myShip.fuel.capacity}`)
    let waitfor = (new Date(myShip.nav.route.arrival)).getTime() - (new Date()).getTime()
    console.log(`${logPrefix}: Waiting for ${msToHMS(waitfor)}`)
    await WaitForMS(waitfor)
    myShip.nav.status = ShipNavStatus.InOrbit // NOTE: Assuming at my own risk!
}

async function DoSellCargo(myShip: Ship, sellInfo: Object, logWhenNoneInInventory: boolean = true) {

    const logPrefix: string = `${myShip.symbol}/sell`

    if (myShip.nav.status != ShipNavStatus.Docked) {
        console.log(`${logPrefix}: Can't sell, not docked!`)
        return
    }

    /*let marketResponse = await system.getMarket(myShip.nav.systemSymbol, myShip.nav.waypointSymbol)
    let tradeGoods = marketResponse.data.data.tradeGoods

    if (!tradeGoods) {
        console.log(`${logPrefix}: Can't sell, no trade goods`)
        return
    }*/

    let runningTotal: number = 0
    let lastResponse: SellCargo201ResponseData = undefined
    for (const [cargoSymbol, requestSellQuantity] of Object.entries(sellInfo)) {
        /*let tradeGoodEntry = tradeGoods.find((i) => i.symbol == cargoSymbol)
        if (!tradeGoodEntry) {
            console.log(`${logPrefix}: Can't sell ${cargoSymbol}, marketplate does not accept this!`)
            continue;
        }*/

        const cargoRecord = myShip.cargo.inventory.find((i) => i.symbol == cargoSymbol)
        if (cargoRecord) {
            let sellQuantity = cargoRecord.units
            if (requestSellQuantity != -1) {
                sellQuantity = requestSellQuantity
            }
            let request: SellCargoRequest = {
                symbol: cargoSymbol,
                units: sellQuantity
            }
            console.log(`${logPrefix}: Try selling ${cargoSymbol} x${sellQuantity}...`)
            let sellResponse = await context.fleetApi.sellCargo(myShip.symbol, request)
            let transaction: MarketTransaction = sellResponse.data.data.transaction
            console.log(`${logPrefix}: ${transaction.tradeSymbol} x${transaction.units}($${transaction.pricePerUnit}/ea) +$${transaction.totalPrice}`)
            //console.log(JSON.stringify(sellResponse.data.data, undefined, 2))
            runningTotal += sellResponse.data.data.transaction.totalPrice
            lastResponse = sellResponse.data.data
        } else {
            if (logWhenNoneInInventory) {
                console.log(`${logPrefix}: Can't sell ${cargoSymbol}, none in cargo!`)
            }
        }
    }
    myShip.cargo = lastResponse.cargo
    console.log(`${logPrefix}: CREDITS: +$${runningTotal.toLocaleString()} | TOTAL: $${lastResponse.agent.credits.toLocaleString()}`)
}

function PrintShipTable(ships: Array<Ship>) {
    let tabledata = []
    ships.forEach((ship) => {
        
        tabledata[ship.symbol] = {
            ["Role"]: ship.registration.role,
            ["Waypoint"]: ship.nav.waypointSymbol, 
            ["Status"]: ship.nav.status,
            ["Flight Mode"]: ship.nav.flightMode,
            ["Fuel"]: `${ship.fuel.current}/${ship.fuel.capacity}`,
            ["Cargo"]: `${ship.cargo.units}/${ship.cargo.capacity}`,
            
            //["Waypoint"]: ship.nav.waypointSymbol, 
            //["Status"]: ship.nav.status,
            //["Flight Mode"]: ship.nav.flightMode,
            //["Role"]: ship.registration.role,
            //["Morale"]: ship.crew.morale,
            //["Fuel"]: `${ship.fuel.current}/${ship.fuel.capacity}`,
            //["Cargo"]: `${ship.cargo.units}/${ship.cargo.capacity}`,
        }

        if (ship.nav.status == ShipNavStatus.InTransit) {
            let deltaTime = CalcShipRouteTimeRemaining(ship.nav.route)
            tabledata[ship.symbol]["Flight Time Remaining"] = `${msToHMS(deltaTime)}`
        }
    })
    console.log("Your Ships:")
    console.table(tabledata)
}

function PrintCargo(shipCargo: ShipCargo) {
    let tabledata = []
    for (const entry of shipCargo.inventory) {
        tabledata[entry.symbol] = {
            units: entry.units
        }
    }
    console.table(tabledata)
}

async function main() {

}

// ==========
// SCAN LOOP

//async function ShipScanLoop(scannerShip: string) {
async function* ShipScanLoop(ships: Ship[], payload: void) {
    let orbitResponse = await context.fleetApi.orbitShip(ships[0].symbol)
    let scanOrigin: string = orbitResponse.data.data.nav.waypointSymbol
    await StartShipScan(ships[0].symbol, scanOrigin)
}

async function StartShipScan(scannerShip: string, scanOrigin: string) {

    let shipScanResponse = await context.fleetApi.createShipShipScan(scannerShip)
    let ships = shipScanResponse.data.data.ships
    //let cooldown: Cooldown = value.data.data.cooldown
    let cooldown = shipScanResponse.data.data.cooldown
    let now = new Date()

    let scanRecord = {
        //_id: new mongoDB.ObjectId(),
        //time: tiemstamp,
        time: now,
        scanner: scannerShip,
        scanOrigin: scanOrigin,
        scanData: ships
    }
    
    context.dbCollections.ShipScan.insertOne(scanRecord)

    let newAgents = []
    let tabledata = {}
    
    // NOTE: carefull! currently if an agent ownes
    // multiple ships in a scan, multipe updates of that
    // agent's record are sent to the db
    for (let x: number = 0; x < ships.length; x++) {
        const ship: ScannedShip = ships[x]
        
        let agentName = utils.SplitShipSymbol(ship.symbol).AgentName

        const agentRecord = await context.dbCollections.Agent.findOne({
            symbol: agentName
        })

        if (!agentRecord) {
            let newRecord = {
                symbol: agentName,
                firstSeen: now,
                lastSeen: now
            }
            await context.dbCollections.Agent.insertOne(newRecord)
            SeenAgents.push(newRecord)
            newAgents.push(agentName)
        } else {
            await context.dbCollections.Agent.updateOne(
                { _id: agentRecord._id }, 
                { $set: { lastSeen: now }})
            SeenAgents.find(s => s.symbol == agentRecord.symbol).lastSeen = now
        }
        
        let nav = ship.nav
        tabledata[ship.symbol] = {
            ["Agent"]: agentName,
            //["System"]: nav.systemSymbol,
            ["Waypoint"]: nav.waypointSymbol,
            ["Status"]: nav.status,
            ["FM"]: utils.ShortenShipNavFlightMode(nav.flightMode),
            ["ROLE"]: ship.registration.role,
            ["Departure"]: `${nav.route.departure.symbol}, ${nav.route.departure.type}`,
            ["Destination"]: `${nav.route.destination.symbol}, ${nav.route.destination.type}`,
            ["Flight Total"]: msToHMS((new Date(nav.route.arrival)).getTime() - (new Date(nav.route.departureTime)).getTime()),
            //["Arrival Time"]: new Date(nav.route.arrival).toLocaleTimeString(),
            ["Time Remaining"]: msToHMS(CalcShipRouteTimeRemaining(nav.route))
        }
    }
    
    console.log("[%s] %s: Preformed Ship Scan, %d Contacts at %s", now.toISOString(), scannerShip, ships.length, scanOrigin)
    console.table(tabledata)
    
    if (newAgents.length != 0) {
        console.log("New Agents Spotted:", JSON.stringify(newAgents))
        console.log(`Seen ${SeenAgents.length} agents in total`)
    }
    
    console.log(`Next possible scan at ${cooldown.expiration}`)

    //console.log(JSON.stringify(cooldown, undefined, 2))

    await WaitForCooldown(cooldown)

    StartShipScan(scannerShip, scanOrigin)
}

// ==========
// MINE LOOP

//async function* ShipMineLoop(minerShipSymbol: string, sellWaypoint: string, mineWaypoint: string) {
async function* ShipMineLoop(ships: Ship[], payload: { sellWaypoint: string, mineWaypoint: string }) {
    //let minerShipSymbol = ships[0].symbol
    let sellWaypoint = payload.sellWaypoint
    let mineWaypoint = payload.mineWaypoint
    let myShip = ships[0]
    do {
        
        //let myShipResponse = await context.fleetApi.getMyShip(minerShipSymbol)
        //let myShip: Ship = myShipResponse.data.data

        // if we're docked, go to orbit
        if (myShip.nav.status == ShipNavStatus.Docked) {
            let orbitShipReponse = await context.fleetApi.orbitShip(myShip.symbol)
            myShip.nav = orbitShipReponse.data.data.nav
        }
        console.log(`${myShip.symbol}/extract: orbiting ${myShip.nav.waypointSymbol}`)

        yield

        if (myShip.nav.waypointSymbol != mineWaypoint) {
            await DoNavigateTo(myShip, mineWaypoint)
            yield
        }

        if (myShip.cargo.units < myShip.cargo.capacity) {
            do {
                let extractResponse = await context.fleetApi.extractResources(myShip.symbol)
                
                let cooldown: Cooldown = extractResponse.data.data.cooldown
                let extracted: Extraction = extractResponse.data.data.extraction
                myShip.cargo = extractResponse.data.data.cargo

                //console.log(JSON.stringify(extractResponse.data.data.extraction, undefined, 2))
                //console.log(JSON.stringify(extractResponse.data.data.cargo, undefined, 2))
                console.log(`${extracted.shipSymbol}/extract: extracted resources: ${extracted.yield.symbol} x${extracted.yield.units}`)
                console.log(`${extracted.shipSymbol}/extract: cargo: ${myShip.cargo.units}/${myShip.cargo.capacity}`)

                await WaitForCooldown(cooldown)
                yield
            } while (myShip.cargo.units < myShip.cargo.capacity)
        } else {
            console.log(`${myShip.symbol}/extract: Not extracting resources, cargo full`)
        }

        yield

        if (myShip.nav.waypointSymbol != sellWaypoint) {
            await DoNavigateTo(myShip, sellWaypoint)
            yield
        }

        if (myShip.nav.status == ShipNavStatus.InOrbit) {
            let dockShipRequest = await context.fleetApi.dockShip(myShip.symbol)
            myShip.nav = dockShipRequest.data.data.nav
            yield
        }
        console.log(`${myShip.symbol}: docked at ${myShip.nav.waypointSymbol}`)

        // test for market?

        PrintCargo(myShip.cargo)

        //PRECIOUS_STONES
        await DoSellCargo(myShip, { 
            "IRON_ORE": -1,
            "COPPER_ORE": -1,
            "ALUMINUM_ORE": -1,
            "SILVER_ORE": -1,
            "GOLD_ORE": -1,
            "PLATINUM_ORE": -1,
            "SILICON_CRYSTALS": -1,
            "ICE_WATER": -1,
            "QUARTZ_SAND": -1,
            "AMMONIA_ICE": -1,
            "DIAMONDS": -1,
        }, false)

        if (myShip.cargo.units == myShip.cargo.capacity) {
            console.log(`[ERROR] ${myShip.symbol} still full after attempted sell! bail out!`)
            return
        }

    } while (true)
}

function PrintWaypoints(wapoints: Array<Waypoint>) {
    let tabledata = []
    wapoints.forEach(wp => {
        let wpEntry = {
            ["Type"]: wp.type,
            ["Faction"]: wp.faction?.symbol,
        }

        let market = wp.traits.find((s) => s.symbol == WaypointTraitSymbolEnum.Marketplace)
        if (market) {
            wpEntry["Market"] = "Market"
        }

        let shipyd = wp.traits.find((s) => s.symbol == WaypointTraitSymbolEnum.Shipyard)
        if (shipyd) {
            wpEntry["Shipyard"] = "Shipyard"
        }

        tabledata[wp.symbol] = wpEntry
    });
    console.table(tabledata)
}

global.GetShips = (async function (dump: boolean = false) {
    let getMyShipsResponse = await context.fleetApi.getMyShips()
    PrintShipTable(getMyShipsResponse.data.data)
    if (dump) {
        console.log(JSON.stringify(getMyShipsResponse.data.data, undefined, 2))
    }
})

global.ShipTrySellCargo = (async function (shipSymbol: string, sellInfo: object) {
    let myShipResponse = await context.fleetApi.getMyShip(shipSymbol)
    let myShip: Ship = myShipResponse.data.data
    DoSellCargo(myShip, sellInfo)
})

global.ShipPrintCargo = (async function (shipSymbol: string) {
    let cargoResponse = await context.fleetApi.getMyShipCargo(shipSymbol)
    console.log(`${shipSymbol}: CARGO [${cargoResponse.data.data.units}/${cargoResponse.data.data.capacity}]`)
    PrintCargo(cargoResponse.data.data)
})

global.ShipTryDock = (async function (shipSymbol: string) {
    let dockShipResponse = await context.fleetApi.dockShip(shipSymbol)
    let nav: ShipNav = dockShipResponse.data.data.nav
    console.log(`${shipSymbol}/ShipTryDock: docked at ${nav.waypointSymbol}`)
})

global.ShipTryOrbit = (async function (shipSymbol: string) {
    let orbitShipRequest = await context.fleetApi.orbitShip(shipSymbol)
    let nav: ShipNav = orbitShipRequest.data.data.nav
    console.log(`${shipSymbol}/ShipTryOrbit: entered orbit around ${nav.waypointSymbol}`)
})

global.ShipRefuel = (async function (shipSymbol: string) {
    const allSystems = context.fleetApi.refuelShip(shipSymbol)

})

global.ShipManualNavigateTo = (async function (shipSymbol: string, waypointSymbol: string) {
    let myShipResponse = await context.fleetApi.getMyShip(shipSymbol)
    let myShip: Ship = myShipResponse.data.data
    await DoNavigateTo(myShip, waypointSymbol)
    console.log(`${myShip.symbol} completed manual navigation to ${waypointSymbol}`)
})

global.IndexJumpGateDestinations = async function (systemSymbol: string, waypointSymbol: string) {
    let totalIndexes = 0
    let gateQueue: { systemSymbol: string, waypointSymbol: string }[] = []
    let seen: string[] = []

    gateQueue.push({ systemSymbol: systemSymbol, waypointSymbol: waypointSymbol })

    do {
        let gate = gateQueue.pop()
        seen.push(gate.systemSymbol)

        let jumpGateInfo = await context.systemApi.getJumpGate(gate.systemSymbol, gate.waypointSymbol)
        for (const dest of jumpGateInfo.data.data.connectedSystems) {
            if ((seen.indexOf(dest.symbol) == -1) && gateQueue.findIndex((x) => x.systemSymbol == dest.symbol) == -1) {
                totalIndexes++
                console.log(`indexing ... ${dest.symbol} (${totalIndexes})`)
                let systemRecord = await context.GetSystemRecord(dest.symbol)
                let records = await context.GetAllSystemWaypoints(dest.symbol)
                for (let entry of records) {
                    if (entry.type == WaypointType.JumpGate) {
                        if ((seen.indexOf(entry.systemSymbol) == -1) && gateQueue.findIndex((x) => x.systemSymbol == dest.symbol) == -1) {
                            gateQueue.push({ systemSymbol: entry.systemSymbol, waypointSymbol: entry.symbol })
                        }
                    }
                }
                await WaitForMS(4000)
            }
        }
        
    } while (gateQueue.length != 0)
    console.log(`done indexing`)
}

global.DownloadAllSystems = async function (page: number, limit: number) {
    let entrycount = 0
    let exit = false
    do {
        let getSystemsResult = await context.systemApi.getSystems(page, limit)

        const data = getSystemsResult.data.data
        const meta = getSystemsResult.data.meta

        for (let sys of data) {
            let dbSystemRecord = await context.dbCollections.System.findOne({
                "data.symbol": sys.symbol
            })

            if (!dbSystemRecord) {
                let systemRecord = {
                    firstRetrieved: new Date(),
                    lastRetrieved: new Date(),
                    data: sys,
                }
                await context.dbCollections.System.insertOne(systemRecord)
            } else {
                dbSystemRecord.lastRetrieved = new Date()
                dbSystemRecord.data = sys
                await context.dbCollections.System.updateOne(
                    { _id: dbSystemRecord._id },
                    { $set: dbSystemRecord })
            }

            entrycount++
        }

        console.log(`DownloadAllSystems finished page ${page} | Indexed ${entrycount} systems`)

        await WaitForMS(5000)

        exit = !(page <= Math.ceil(meta.total / limit))
        page += 1

    } while(!exit)
    console.log(`DownloadAllSystems Finished`)
}

global.GetWaypointRecord = async function (systemSymbol: string, waypointSymbol: string, forceAPI: boolean = false) {
    let record = await context.GetWaypointRecord(systemSymbol, waypointSymbol, forceAPI)
    PrintWaypoints([ (record as any).data ])
    //console.log(JSON.stringify(record, undefined, 2))
}

global.GetAllSystemWaypoints = async function (systemSymbol: string, forceAPI: boolean = false) {
    let records = await context.GetAllSystemWaypoints(systemSymbol, forceAPI)
    PrintWaypoints(records)
}

global.DrawMap = (async function () {
    let systemList: System[] = []
    let allSystems = context.dbCollections.System.find({})
    for await (const system of allSystems){
        systemList.push(system.data as System)
    }
    MapRender.DrawGalaxy(systemList, "./render/")
    /*{
        const jsonText: string = fs.readFileSync("./X1-ZA40-28549E.json", "utf-8")
        
        let gateData = JSON.parse(jsonText)
        let array = gateData.data.connectedSystems as Array<any>
        MapRender.Render(array, "./X1-ZA40-28549E-gatemap.png")
    }
    {
        const jsonText: string = fs.readFileSync("./X1-HN46-66989X.json", "utf-8")
        
        let gateData = JSON.parse(jsonText)
        let array = gateData.data.connectedSystems as Array<any>
        MapRender.Render(array, "./X1-HN46-66989X-gatemap.png")
    }*/
})

global.DrawSystem = (async function (systemName: string) {
    //let systemData = await context.systemApi.getSystem(systemName)
    let systemData = await context.GetSystemRecord(systemName)
    MapRender.DrawSystem(systemData.data)
})

global.AgentList = (async function () {
    let sortedList = SeenAgents.map((s) => { return { symbol: s.symbol, lastSeen: s.lastSeen } })
    let longestName = _.maxBy(SeenAgents, (s) => s.symbol.length).symbol.length
    sortedList.sort((x, y) => { return y.lastSeen.getTime() - x.lastSeen.getTime()})
    for (let x = 0; x < sortedList.length; x++) {
        console.log(`[${x.toString().padStart(3,' ')}] ${sortedList[x].symbol.padEnd(longestName, ' ')} ${sortedList[x].lastSeen}`)
    }
    //console.table(sortedList)
})

global.GetMarket = (async function (systemSymbol: string, waypointSymbol: string, dump: boolean = true) {
    let getMarketResponse = await context.systemApi.getMarket(systemSymbol, waypointSymbol)
    console.log(JSON.stringify(getMarketResponse.data.data, undefined, 2))
})

global.GetShipyard = (async function (systemSymbol: string, waypointSymbol: string, dump: boolean = true) {
    let getShipyardResponse = await context.systemApi.getShipyard(systemSymbol, waypointSymbol)
    console.log(JSON.stringify(getShipyardResponse.data.data, undefined, 2))
})

global.GetJumpGate = (async function (systemSymbol: string, waypointSymbol: string) {
    let getJumpGateResponse = await context.systemApi.getJumpGate(systemSymbol, waypointSymbol)
    console.log(JSON.stringify(getJumpGateResponse.data.data, undefined, 2))
})

global.whoami = (async function(full: boolean = false) {
    let agentResponse = await context.agentApi.getMyAgent()
    console.log(`[whoami] ${agentResponse.data.data.symbol}`)
    console.log(`[whoami] Credits: ${agentResponse.data.data.credits.toLocaleString()}`)
    console.log(`[whoami] Headquarters: ${agentResponse.data.data.headquarters}`)
    if (full) {
        console.log(`[whoami] accountId: ${agentResponse.data.data.accountId}`)
    }
})

global.spacetraders = (async function(extra: boolean = true) {
    let statusResponse = await context.defaultApi.getStatus()
    let status = statusResponse.data

    let now: Date = new Date()
    let nextReset: Date = new Date(status.serverResets.next)
    let timeLefMS = nextReset.getTime() - now.getTime()

    console.log("┌─────────────────┐")
    console.log("├ spacetraders.io ┤")
    console.log("└─────────────────┘")
    console.log(`Α: ${status.status}`)
    console.log(`Ω: Next reset in ${msToDHMS(timeLefMS)} [${nextReset}]`)
    if (extra) {
        console.log(`# ${status.stats.agents.toLocaleString()} Agents, ${status.stats.ships.toLocaleString()} Ships`)
        console.log(`# ${status.stats.systems.toLocaleString()} Systems, ${status.stats.waypoints.toLocaleString()} Waypoints`)
        const mostCredits = status.leaderboards.mostCredits[0]
        const mostCharts = status.leaderboards.mostSubmittedCharts[0]
        const chartPercent = (mostCharts.chartCount * 100) / status.stats.waypoints
        console.log(`Leaderboard │`)
        console.log(`╒═══════════╛`)
        console.log(`├─ CREDITS: ${mostCredits.agentSymbol}, $${mostCredits.credits.toLocaleString()}`)
        console.log(`├─ CHARTS : ${mostCharts.agentSymbol}, ${mostCharts.chartCount} Charts (%${ Math.round((chartPercent + Number.EPSILON) * 10000) / 10000 })`)
    }

})

main()
