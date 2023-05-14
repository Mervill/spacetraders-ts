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
} from './packages/spacetraders-sdk'

// FLIGHT MODE
// DRIFT, STEALTH, CRUISE, BURN
// DR     ST       CR      BU
//
// STATUS
// IN_TRANSIT, IN_ORBIT, DOCKED
// TR          OR        DO

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

//console.log(JSON.stringify(SplitLocationSymbol("X1-DF55-17335A")))
//console.log(JSON.stringify(SplitLocationSymbol("X1-DF55")))
//console.log(JSON.stringify(SplitLocationSymbol("X1")))

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

async function main() {
    
    console.log("The current time is %s", new Date().toLocaleTimeString())

    await mongoDBConnect();

    await agent.getMyAgent().then(function (value: AxiosResponse<GetMyAgent200Response>) {
        console.log("Connected to SpaceTraders!")
        console.log(`Welcome ${value.data.data.symbol}. Your Credits: ${value.data.data.credits}`)
        //value.data.data.accountId
        console.log(`Headquarters: ${value.data.data.headquarters}`)
    }, DefaultOnRejected)

    console.log("loading seen agents...")
    const allAgents = await dbCollections.Agent.find({})
    for await (const agent of allAgents){
        SeenAgents.push(agent.symbol)
    }
    console.log("...done")

    await fleet.getMyShips().then(async function (value: AxiosResponse<GetMyShips200Response>) {        
        var tabledata = []
        value.data.data.forEach((ship) => {
            tabledata[ship.symbol] = {
                //system: ship.nav.systemSymbol,
                ["Waypoint"]: ship.nav.waypointSymbol, 
                ["Status"]: ship.nav.status,
                ["Flight Mode"]: ship.nav.flightMode,
                ["Morale"]: ship.crew.morale 
            }
        })

        console.log("Your Ships:")
        console.table(tabledata)
        //console.log(JSON.stringify(value.data, undefined, 2))

        let activeShip = value.data.data[0].symbol
        let scanOrigin = ""

        await fleet.orbitShip(activeShip).then(function (value: any) {
            console.log("%s: Switched to Orbit", activeShip)
            let nav: ShipNav = value.data.data.nav
            scanOrigin = nav.waypointSymbol
            let tabledata = {}
            tabledata[activeShip] = {
                //["System"]: nav.systemSymbol,
                ["Waypoint"]: nav.waypointSymbol,
                ["Status"]: nav.status,
                ["Flight Mode"]: nav.flightMode
            }
            console.table(tabledata)
        }, DefaultOnRejected)

        await fleet.getShipCooldown(activeShip).then(async function (value: AxiosResponse<GetShipCooldown200Response>){
            if (value.status == 200) {
                await new Promise((resolve) => {
                    let now: Date = new Date()
                    let expiration: Date = new Date(value.data.data.expiration)
                    let timeLefMS = expiration.getTime() - now.getTime()
                    console.log(`${activeShip} is currently in cooldown, expiry ${msToHMS(timeLefMS)}`)
                    setTimeout(resolve, timeLefMS)
                })
            }
        }, DefaultOnRejected)

        await StartShipScan(activeShip, scanOrigin)

        /*fleet.dockShip(value.data.data[0].symbol).then(function (value: any) {
            console.log(JSON.stringify(value.data, undefined, 2))
        }, DefaultOnRejected)*/

    }, DefaultOnRejected)
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

main()