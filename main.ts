import axios, { AxiosResponse } from 'axios'
import * as mongoDB from "mongodb";
import * as dotenv from "dotenv";
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
  GetMyShips200Response,
  GetMyAgent200Response,
  CreateShipShipScan201Response,
  GetShipCooldown200Response,
  Ship,
  ScannedShip,
  OrbitShip200Response,
  ShipNavStatus,
  NavigateShipRequest,
  ShipFuel,
  Extraction,
  SellCargoRequest,
  ShipCargo,
  MarketTransaction,
  SellCargo201ResponseData,
} from './packages/spacetraders-sdk'

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
} = { }

export const configuration = new Configuration({
  basePath: process.env.BASE_PATH,
  accessToken: process.env.SPACETRADERS_TOKEN
})

export const axoisInstance = axios.create({})

// example retry logic for 429 rate-limit errors
axoisInstance.interceptors.response.use(undefined, async (error) => {
  const apiError = error.response?.data?.error

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

const system = new SystemsApi(configuration, undefined, axoisInstance)
const agent = new AgentsApi(configuration, undefined, axoisInstance)
const fleet = new FleetApi(configuration, undefined, axoisInstance)

let ScanRecords = []
let SeenAgents = []

let AgentShips = []
async function mongoDBConnect() {
    await mongoClient.connect()
    const db: mongoDB.Db = mongoClient.db(process.env.DB_NAME)
    const shipScanCollection: mongoDB.Collection = db.collection("ShipScan")
    const agentCollection: mongoDB.Collection = db.collection("Agent")
    dbCollections.ShipScan = shipScanCollection
    dbCollections.Agent = agentCollection
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

function ISOTimeStamp(): string {
    return (new Date().toISOString())
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

async function WaitForMS(timeMS: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeMS)
    })
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

    console.log(`${logPrefix}: Navigating to ${myShip.nav.waypointSymbol} ${myShip.nav.route.destination.type}`)
    //console.log(JSON.stringify(myShip.fuel.consumed))
    //console.log(JSON.stringify(myShip.nav))
    let now = new Date()
    //console.log(now.toISOString())
    //console.log(myShip.nav.route.departureTime)
    //console.log(new Date(myShip.nav.route.departureTime).getTime() - now.getTime())
    //console.log(myShip.nav.route.arrival)
    console.log(`${logPrefix}: Flight time is ${msToHMS(totalDeltaTime)}`) //${totalDeltaTime}
    console.log(`${logPrefix}: Flight consumed ${myShip.fuel.consumed.amount} fuel. Fuel: ${myShip.fuel.current}/${myShip.fuel.capacity}`)
    let waitfor = (new Date(myShip.nav.route.arrival)).getTime() - (now).getTime()
    console.log(`${logPrefix} Waiting for ${msToHMS(waitfor)}`) //${waitfor}
    await WaitForMS(waitfor)
    myShip.nav.status = ShipNavStatus.InOrbit // NOTE: Assuming at my own risk!
}

async function DoSellCargo(myShip: Ship, sellInfo: Object) {

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
            console.log(`${logPrefix}: Can't sell, no ${cargoSymbol} in cargo!`)
        }
    }
    console.log(`${logPrefix}: CREDITS: +$${runningTotal.toLocaleString()} ${lastResponse.agent.credits.toLocaleString()}`)
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
    
    console.log("The current time is %s", new Date().toLocaleTimeString())

    await mongoDBConnect();

    await agent.getMyAgent().then(function (value: AxiosResponse<GetMyAgent200Response>) {
        console.log(`Connected to SpaceTraders.io!`)
        console.log(`${value.data.data.symbol}`)
        console.log(`Credits: ${value.data.data.credits.toLocaleString()}`)
        console.log(`Headquarters: ${value.data.data.headquarters}`)
        console.log(`accountId: ${value.data.data.accountId}`)
    }, DefaultOnRejected)

    console.log("loading seen agents...")
    const allAgents = await dbCollections.Agent.find({})
    for await (const agent of allAgents){
        SeenAgents.push(agent.symbol)
    }
    console.log("...done")

    let activeShip: string = ""

    await fleet.getMyShips().then(async function (value: AxiosResponse<GetMyShips200Response>) {        
        var tabledata = []
        value.data.data.forEach((ship) => {
            tabledata[ship.symbol] = {
                ["Waypoint"]: ship.nav.waypointSymbol, 
                ["Status"]: ship.nav.status,
                ["Flight Mode"]: ship.nav.flightMode,
                ["Role"]: ship.registration.role,
                ["Morale"]: ship.crew.morale,
                ["Fuel"]: `${ship.fuel.current}/${ship.fuel.capacity}`
            }
        })

        console.log("Your Ships:")
        console.table(tabledata)
        //console.log(JSON.stringify(value.data, undefined, 2))

        activeShip = value.data.data[0].symbol
        //scanOrigin = ""

    }, DefaultOnRejected)

    //await ShipScanLoop(activeShip)

    let myShipResponse = await fleet.getMyShip(activeShip)
    let myShip: Ship = myShipResponse.data.data
    PrintCargo(myShip.cargo)
    
    //await fleet.orbitShip(activeShip)
    //await DoNavigateTo(myShip, "X1-ZA40-99095A");
    //await fleet.dockShip(activeShip)
    /*await DoSellCargo(myShip, { 
        "IRON_ORE": -1,
        "COPPER_ORE": -1,
        "ALUMINUM_ORE": -1,
        "SILVER_ORE": -1,
        "GOLD_ORE": -1,
        "PLATINUM_ORE": -1,
        "SILICON_CRYSTALS": -1,
    })*/

    await ShipMineLoop(activeShip, "X1-ZA40-99095A", "X1-ZA40-99095A")

    /*fleet.dockShip(value.data.data[0].symbol).then(function (value: any) {
        console.log(JSON.stringify(value.data, undefined, 2))
    }, DefaultOnRejected)*/
}

// ==========
// SCAN LOOP

async function ShipScanLoop(scannerShip: string) {
    
    let scanOrigin: string

    await fleet.orbitShip(scannerShip).then(function (value: AxiosResponse<OrbitShip200Response>) {
        console.log("%s: Switched to Orbit", scannerShip)
        /*
        let nav: ShipNav = value.data.data.nav
        scanOrigin = nav.waypointSymbol
        let tabledata = {}
        tabledata[scannerShip] = {
            //["System"]: nav.systemSymbol,
            ["Waypoint"]: nav.waypointSymbol,
            ["Status"]: nav.status,
            ["Flight Mode"]: nav.flightMode
        }
        console.table(tabledata)
        */
    }, DefaultOnRejected)

    await fleet.getShipCooldown(scannerShip).then(async function (value: AxiosResponse<GetShipCooldown200Response>){
        if (value.status == 200) {
            await new Promise((resolve) => {
                let now: Date = new Date()
                let expiration: Date = new Date(value.data.data.expiration)
                let timeLefMS = expiration.getTime() - now.getTime()
                console.log(`${scannerShip} is currently in cooldown, expiry ${msToHMS(timeLefMS)}`)
                setTimeout(resolve, timeLefMS)
            })
        }
    }, DefaultOnRejected)

    await StartShipScan(scannerShip, scanOrigin)
}

async function StartShipScan(scannerShip: string, scanOrigin: string) {

    let cooldown: Cooldown = undefined

    await fleet.createShipShipScan(scannerShip).then(async function (value: AxiosResponse<CreateShipShipScan201Response>) {
        let ships = value.data.data.ships
        //let cooldown: Cooldown = value.data.data.cooldown
        cooldown = value.data.data.cooldown
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
                await dbCollections.Agent.insertOne({
                    symbol: agentName,
                    firstSeen: now,
                    lastSeen: now
                })
                SeenAgents.push(agentName)
                newAgents.push(agentName)
            } else {
                await dbCollections.Agent.updateOne(
                    { _id: agentRecord._id }, 
                    { $set: { lastSeen: now }})
            }
            
            let nav = ship.nav
            tabledata[ship.symbol] = {
                ["Agent"]: agentName,
                //["System"]: nav.systemSymbol,
                ["Waypoint"]: nav.waypointSymbol,
                ["Status"]: nav.status,
                ["FM"]: utils.ShortenShipNavFlightMode(nav.flightMode),
                ["ROLE"]: ship.registration.role,
                ["Departure"]: nav.route.departure.symbol + ", " + nav.route.departure.type,
                ["Destination"]: nav.route.destination.symbol + ", " + nav.route.destination.type,
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
    }, DefaultOnRejected)
    
    await new Promise((resolve) => {
        let now: Date = new Date()
        let expiration: Date = new Date(cooldown.expiration)
        let timeLefMS = expiration.getTime() - now.getTime()
        console.log(`${scannerShip} is currently in cooldown, expiry ${msToHMS(timeLefMS)}`)
        setTimeout(resolve, timeLefMS)
    })

    StartShipScan(scannerShip, scanOrigin)
}

// ==========
// MINE LOOP

async function ShipMineLoop(minerShipSymbol: string, originWaypoint: string, destinationWaypoint: string) {

    /*await fleet.orbitShip(minerShip).then(function (value: AxiosResponse<OrbitShip200Response>) {
        console.log("%s: Switched to Orbit", minerShip)
    }, DefaultOnRejected)*/

    let myShipResponse = await fleet.getMyShip(minerShipSymbol)
    let myShip: Ship = myShipResponse.data.data

    // wait for any active cooldown to finish
    {
        let cooldownResponse = await fleet.getShipCooldown(minerShipSymbol)
        if (cooldownResponse.status == 200) {
            let cooldown: Cooldown = cooldownResponse.data.data
            await WaitForCooldown(cooldown)
        }
    }

    // if we're docked, go to orbit
    if (myShip.nav.status == ShipNavStatus.Docked) {
        let orbitShipReponse = await fleet.orbitShip(minerShipSymbol)
        myShip.nav = orbitShipReponse.data.data.nav
    }

    console.log(`${minerShipSymbol}/extract: orbiting ${myShip.nav.waypointSymbol}`)

    await DoNavigateTo(myShip, destinationWaypoint);

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
        console.log(`${minerShipSymbol}/extract: Not extracting resources, cargo full`)
    }

    await DoNavigateTo(myShip, originWaypoint);

    if (myShip.nav.status == ShipNavStatus.InOrbit) {
        let dockShipRequest = await fleet.dockShip(myShip.symbol)
        myShip.nav = dockShipRequest.data.data.nav
    }

    console.log(`${minerShipSymbol}: docked at ${myShip.nav.waypointSymbol}`)

    PrintCargo(myShip.cargo)

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
    })

    ShipMineLoop(minerShipSymbol, originWaypoint, destinationWaypoint)
}

global.GetShips = (async function (dump: boolean = false) {
    await fleet.getMyShips().then(function (value: AxiosResponse<GetMyShips200Response>) {
        var tabledata = []
        value.data.data.forEach((ship) => {
            tabledata[ship.symbol] = {
                ["Waypoint"]: ship.nav.waypointSymbol, 
                ["Status"]: ship.nav.status,
                ["Flight Mode"]: ship.nav.flightMode,
                ["Role"]: ship.registration.role,
                ["Morale"]: ship.crew.morale,
                ["Fuel"]: `${ship.fuel.current}/${ship.fuel.capacity}`
            }
        })

        console.log("Your Ships:")
        console.table(tabledata)
        if (dump) {
            console.log(JSON.stringify(value.data.data, undefined, 2))
        }

    }, DefaultOnRejected)
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

global.whoami = (async function() {
    await agent.getMyAgent().then(function (value: AxiosResponse<GetMyAgent200Response>) {
        console.log(`[whoami] ${value.data.data.symbol}`)
        console.log(`[whoami] Credits: ${value.data.data.credits.toLocaleString()}`)
        console.log(`[whoami] Headquarters: ${value.data.data.headquarters}`)
        console.log(`[whoami] accountId: ${value.data.data.accountId}`)
    }, DefaultOnRejected)
})

main()
