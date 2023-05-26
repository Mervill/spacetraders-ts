import axios, { AxiosResponse } from 'axios'
import * as _ from "lodash"
import * as mongoDB from "mongodb"
import * as dotenv from "dotenv"
import * as Canvas from "canvas"
import * as MapRender from "./src/MapRenderer"
import * as utils from "./utils"
import {
  Configuration,
  Cooldown,
  //DefaultApi,
  FactionsApi,
  FleetApi,
  ContractsApi,
  SystemsApi,
  AgentsApi,
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
} from './packages/spacetraders-sdk'
import * as fs from 'fs'
import { AgentRecord } from './src/types'

// FLIGHT MODE
// DRIFT, STEALTH, CRUISE, BURN
// DR     ST       CR      BU
//
// STATUS
// IN_TRANSIT, IN_ORBIT, DOCKED
// TR          OR        DO

//console.log(JSON.stringify(SplitLocationSymbol("X1-DF55-17335A")))
//console.log(JSON.stringify(SplitLocationSymbol("X1-DF55")))
//console.log(JSON.stringify(SplitLocationSymbol("X1")))

dotenv.config();

export const mongoClient: mongoDB.MongoClient = new mongoDB.MongoClient(process.env.DB_CONN_STRING)
export const dbCollections: { 
    Agent?: mongoDB.Collection
    ShipScan?: mongoDB.Collection
    Waypoint?: mongoDB.Collection
} = { }

export const configuration = new Configuration({
  basePath: process.env.BASE_PATH,
  accessToken: process.env.SPACETRADERS_TOKEN
})

export const axoisInstance = axios.create({})

// example retry logic for 429 rate-limit errors
axoisInstance.interceptors.response.use(undefined, async (error) => {
    //const apiError = error.response?.data?.error
  if (error.response?.status === 429) {
    const retryAfter = error.response.headers['retry-after']
    console.log(`GOT ERROR 429 rate-limit, retry after ${retryAfter}s`)
    await new Promise((resolve) => {
      setTimeout(resolve, retryAfter * 1000)
    })
    return axoisInstance.request(error.config)
  }
  throw error
})

axoisInstance.interceptors.response.use(undefined, async (error) => {
    if (error.response?.status === 409 && error.response.data !== undefined) {
        console.log(JSON.stringify(error.response.data, undefined, 2))
    }
    throw error
})

const system = new SystemsApi(configuration, undefined, axoisInstance)
const agent = new AgentsApi(configuration, undefined, axoisInstance)
const fleet = new FleetApi(configuration, undefined, axoisInstance)

let SeenAgents: AgentRecord[] = []

async function mongoDBConnect() {
    // NOTE: mongodb connection keeps the prorgam alive?
    await mongoClient.connect()
    const db: mongoDB.Db = mongoClient.db(process.env.DB_NAME)
    const shipScanCollection: mongoDB.Collection = db.collection("ShipScan")
    const agentCollection: mongoDB.Collection = db.collection("Agent")
    const waypointCollection: mongoDB.Collection = db.collection("Waypoint")
    dbCollections.ShipScan = shipScanCollection
    dbCollections.Agent = agentCollection
    dbCollections.Waypoint = waypointCollection
    console.log(`Successfully connected to database: ${db.databaseName}`)
}

function DefaultOnRejected(reason: any) {
    console.log("!!!!! REQUEST REJECTED !!!!!")
    console.log(JSON.stringify(reason, undefined, 2))
}

function SplitShipSymbol(shipSymbol: string) {
    let seperatorPosition = shipSymbol.lastIndexOf("-")
    let agentName = shipSymbol.substring(0, seperatorPosition)
    let shipNumber = shipSymbol.substring(seperatorPosition + 1)
    return { AgentName: agentName, ShipNumber: shipNumber }
}

function SplitLocationSymbol(rawLocation: string) {
    const parts: string[] = rawLocation.split('-')
    const sectorPart: string = parts[0]
    const systemPart: string = parts[1]
    const waypointPart: string = parts[2]
    return { Sector: sectorPart, System: systemPart, Waypoint: waypointPart }
}

function CalcShipRouteTimeRemaining(route: ShipNavRoute) {
    let nowDate = new Date()
    let depatureDate = new Date(route.departureTime)
    let arrivalDate = new Date(route.arrival)
    let timeRemaining = arrivalDate.getTime() - nowDate.getTime()
    return timeRemaining
}

function msToHMS(ms) {
    // 1- Convert to seconds:
    let seconds = Math.floor(ms / 1000);
    // 2- Extract hours:
    const hours = Math.floor(seconds / 3600); // 3,600 seconds in 1 hour
    seconds = seconds % 3600; // seconds remaining after extracting hours
    // 3- Extract minutes:
    const minutes = Math.floor(seconds / 60); // 60 seconds in 1 minute
    // 4- Keep only seconds not extracted to minutes:
    seconds = seconds % 60;
    return hours.toString().padStart(2,"0")+":"+minutes.toString().padStart(2,"0")+":"+seconds.toString().padStart(2,"0");
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

    let navigationResponse = await fleet.getShipNav(shipSymbol)
    let nav: ShipNav = navigationResponse.data.data
    if (nav.status == ShipNavStatus.InTransit) {
        let now = new Date()
        let waitfor = (new Date(nav.route.arrival)).getTime() - (now).getTime()
        console.log(`${shipSymbol}/waitIdle: Waiting on transit, complete in ${msToHMS(waitfor)}`)
        await WaitForMS(waitfor)
    } else {
        let cooldownResponse = await fleet.getShipCooldown(shipSymbol)
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
    let navigateResponse = await fleet.navigateShip(myShip.symbol, navigateRequest);

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

    let marketResponse = await system.getMarket(myShip.nav.systemSymbol, myShip.nav.waypointSymbol)
    let tradeGoods = marketResponse.data.data.tradeGoods

    if (!tradeGoods) {
        console.log(`${logPrefix}: Can't sell, no trade goods`)
        return
    }

    let runningTotal: number = 0
    let lastResponse: SellCargo201ResponseData = undefined
    for (const [cargoSymbol, requestSellQuantity] of Object.entries(sellInfo)) {
        let tradeGoodEntry = tradeGoods.find((i) => i.symbol == cargoSymbol)
        if (!tradeGoodEntry) {
            console.log(`${logPrefix}: Can't sell ${cargoSymbol}, marketplate does not accept this!`)
            continue;
        }

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
            let sellResponse = await fleet.sellCargo(myShip.symbol, request)
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

async function ShipScanLoop(scannerShip: string) {
    let orbitResponse = await fleet.orbitShip(scannerShip)
    let scanOrigin: string = orbitResponse.data.data.nav.waypointSymbol
    await StartShipScan(scannerShip, scanOrigin)
}

async function StartShipScan(scannerShip: string, scanOrigin: string) {

    let shipScanResponse = await fleet.createShipShipScan(scannerShip)
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
    
    dbCollections.ShipScan.insertOne(scanRecord)

    let newAgents = []
    let tabledata = {}
    
    // NOTE: carefull! currently if an agent ownes
    // multiple ships in a scan, multipe updates of that
    // agent's record are sent to the db
    for (let x: number = 0; x < ships.length; x++) {
        const ship: ScannedShip = ships[x]
        
        let agentName = SplitShipSymbol(ship.symbol).AgentName

        const agentRecord = await dbCollections.Agent.findOne({
            symbol: agentName
        })

        if (!agentRecord) {
            let newRecord = {
                symbol: agentName,
                firstSeen: now,
                lastSeen: now
            }
            await dbCollections.Agent.insertOne(newRecord)
            SeenAgents.push(newRecord)
            newAgents.push(agentName)
        } else {
            await dbCollections.Agent.updateOne(
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
    
    console.log("[%s] %s: Preformed Ship Scan, %d Contacts", now.toISOString(), scannerShip, ships.length)
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

async function ShipMineLoop(minerShipSymbol: string, sellWaypoint: string, mineWaypoint: string) {

    let myShipResponse = await fleet.getMyShip(minerShipSymbol)
    let myShip: Ship = myShipResponse.data.data

    // if we're docked, go to orbit
    if (myShip.nav.status == ShipNavStatus.Docked) {
        let orbitShipReponse = await fleet.orbitShip(myShip.symbol)
        myShip.nav = orbitShipReponse.data.data.nav
    }
    console.log(`${myShip.symbol}/extract: orbiting ${myShip.nav.waypointSymbol}`)

    if (myShip.nav.waypointSymbol != mineWaypoint) {
        await DoNavigateTo(myShip, mineWaypoint)
    }

    if (myShip.cargo.units < myShip.cargo.capacity) {
        do {
            let extractResponse = await fleet.extractResources(minerShipSymbol)
            
            let cooldown: Cooldown = extractResponse.data.data.cooldown
            let extracted: Extraction = extractResponse.data.data.extraction
            myShip.cargo = extractResponse.data.data.cargo

            //console.log(JSON.stringify(extractResponse.data.data.extraction, undefined, 2))
            //console.log(JSON.stringify(extractResponse.data.data.cargo, undefined, 2))
            console.log(`${extracted.shipSymbol}/extract: extracted resources: ${extracted.yield.symbol} x${extracted.yield.units}`)
            console.log(`${extracted.shipSymbol}/extract: cargo: ${myShip.cargo.units}/${myShip.cargo.capacity}`)

            await WaitForCooldown(cooldown)
        } while (myShip.cargo.units < myShip.cargo.capacity)
    } else {
        console.log(`${myShip.symbol}/extract: Not extracting resources, cargo full`)
    }

    if (myShip.nav.waypointSymbol != sellWaypoint) {
        await DoNavigateTo(myShip, sellWaypoint)
    }

    if (myShip.nav.status == ShipNavStatus.InOrbit) {
        let dockShipRequest = await fleet.dockShip(myShip.symbol)
        myShip.nav = dockShipRequest.data.data.nav
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

    ShipMineLoop(minerShipSymbol, sellWaypoint, mineWaypoint)
}

global.GetShips = (async function (dump: boolean = false) {
    let getMyShipsResponse = await fleet.getMyShips()
    PrintShipTable(getMyShipsResponse.data.data)
    if (dump) {
        console.log(JSON.stringify(getMyShipsResponse.data.data, undefined, 2))
    }
})

global.ShipTrySellCargo = (async function (shipSymbol: string, sellInfo: object) {
    let myShipResponse = await fleet.getMyShip(shipSymbol)
    let myShip: Ship = myShipResponse.data.data
    DoSellCargo(myShip, sellInfo)
})

global.ShipPrintCargo = (async function (shipSymbol: string) {
    let cargoResponse = await fleet.getMyShipCargo(shipSymbol)
    console.log(`${shipSymbol}: CARGO [${cargoResponse.data.data.units}/${cargoResponse.data.data.capacity}]`)
    PrintCargo(cargoResponse.data.data)
})

global.ShipTryDock = (async function (shipSymbol: string) {
    let dockShipResponse = await fleet.dockShip(shipSymbol)
    let nav: ShipNav = dockShipResponse.data.data.nav
    console.log(`${shipSymbol}/ShipTryDock: docked at ${nav.waypointSymbol}`)
})

global.ShipTryOrbit = (async function (shipSymbol: string) {
    let orbitShipRequest = await fleet.orbitShip(shipSymbol)
    let nav: ShipNav = orbitShipRequest.data.data.nav
    console.log(`${shipSymbol}/ShipTryOrbit: entered orbit around ${nav.waypointSymbol}`)
})

global.ShipManualNavigateTo = (async function (shipSymbol: string, waypointSymbol: string) {
    let myShipResponse = await fleet.getMyShip(shipSymbol)
    let myShip: Ship = myShipResponse.data.data
    await DoNavigateTo(myShip, waypointSymbol)
})

async function GetWaypointRecord(systemSymbol: string, waypointSymbol: string, forceAPI: boolean = false) {
    
    let waypointRecord = undefined

    let dbWaypointRecord = await dbCollections.Waypoint.findOne({
        "data.systemSymbol": systemSymbol,
        "data.symbol": waypointSymbol,
    })
    
    if ((!dbWaypointRecord) || (forceAPI)) {
        let getWaypointResponse = await system.getWaypoint(systemSymbol, waypointSymbol)
        if (!dbWaypointRecord) {
            waypointRecord = {
                firstRetrieved: new Date(),
                lastRetrieved: new Date(),
                data: getWaypointResponse.data.data,
            }
            await dbCollections.Waypoint.insertOne(waypointRecord)
        } else {
            dbWaypointRecord.lastRetrieved = new Date()
            dbWaypointRecord.data = getWaypointResponse.data.data    
            await dbCollections.Waypoint.updateOne(
                { _id: dbWaypointRecord._id },
                { $set: dbWaypointRecord })
            waypointRecord = dbWaypointRecord
        }
    } else {
        waypointRecord = dbWaypointRecord
    }

    return waypointRecord
}

function PrintWaypoints(wapoints: Array<Waypoint>) {
    let tabledata = []
    wapoints.forEach(wp => {
        let wpEntry = {
            ["Type"]: wp.type,
            ["Faction"]: wp.faction.symbol,
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

global.GetWaypointRecord = async function (systemSymbol: string, waypointSymbol: string, forceAPI: boolean = false) {
    let record = await GetWaypointRecord(systemSymbol, waypointSymbol, forceAPI)
    PrintWaypoints([ (record as any).data ])
    //console.log(JSON.stringify(record, undefined, 2))
}

global.GetAllSystemWaypoints = async function (systemSymbol: string, forceAPI: boolean = false) {
    let getSystemResponse = await system.getSystem(systemSymbol)
    let records: Array<Waypoint> = []
    for (let wp of getSystemResponse.data.data.waypoints) {
        let record = await GetWaypointRecord(systemSymbol, wp.symbol, forceAPI)
        records.push(record.data)
    }
    PrintWaypoints(records)
}

// https://stackoverflow.com/questions/33599688/how-to-use-es8-async-await-with-streams
global.DrawMap = (async function() {
    {
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
    }
})

global.DrawSystem = (async function(systemName: string) {
    let systemData = await system.getSystem(systemName)
    MapRender.DrawSystem(systemData.data.data)
})

global.AgentList = (async function() {
    let sortedList = SeenAgents.map((s) => { return { symbol: s.symbol, lastSeen: s.lastSeen } })
    let longestName = _.maxBy(SeenAgents, (s) => s.symbol.length).symbol.length
    sortedList.sort((x, y) => { return y.lastSeen.getTime() - x.lastSeen.getTime()})
    for (let x = 0; x < sortedList.length; x++) {
        console.log(`[${x.toString().padStart(3,' ')}] ${sortedList[x].symbol.padEnd(longestName, ' ')} ${sortedList[x].lastSeen}`)
    }
    //console.table(sortedList)
})

global.whoami = (async function() {
    let agentResponse = await agent.getMyAgent()
    console.log(`[whoami] ${agentResponse.data.data.symbol}`)
    console.log(`[whoami] Credits: ${agentResponse.data.data.credits.toLocaleString()}`)
    console.log(`[whoami] Headquarters: ${agentResponse.data.data.headquarters}`)
    console.log(`[whoami] accountId: ${agentResponse.data.data.accountId}`)
})

main()
