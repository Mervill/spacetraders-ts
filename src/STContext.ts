import * as mongoDB from "mongodb"
import { AxiosInstance } from 'axios'
import { 
    Configuration,
    DefaultApi,
    SystemsApi,
    AgentsApi,
    FleetApi,
    Waypoint,
} from "../packages/spacetraders-sdk"

export class STContext {

    mongoClient: mongoDB.MongoClient

    dbCollections: { 
        Agent?: mongoDB.Collection
        ShipScan?: mongoDB.Collection
        System?: mongoDB.Collection
        Waypoint?: mongoDB.Collection
        Shipyard?: mongoDB.Collection
    } = { }    

    axoisInstance: AxiosInstance

    apiConfig: Configuration

    defaultApi: DefaultApi
    systemApi: SystemsApi
    agentApi: AgentsApi
    fleetApi: FleetApi

    constructor(axoisInstance: AxiosInstance) {

        this.mongoClient = new mongoDB.MongoClient(process.env.DB_CONN_STRING)

        this.axoisInstance = axoisInstance

        this.apiConfig = new Configuration({
            basePath: process.env.BASE_PATH,
            accessToken: process.env.SPACETRADERS_TOKEN
        })

        this.defaultApi = new DefaultApi(this.apiConfig, undefined, this.axoisInstance)
        this.systemApi = new SystemsApi(this.apiConfig, undefined, this.axoisInstance)
        this.agentApi = new AgentsApi(this.apiConfig, undefined, this.axoisInstance)
        this.fleetApi = new FleetApi(this.apiConfig, undefined, this.axoisInstance)

    }

    public async mongoDBConnect() {
        // NOTE: mongodb connection keeps the prorgam alive?
        await this.mongoClient.connect()
        const db: mongoDB.Db = this.mongoClient.db(process.env.DB_NAME)
        this.dbCollections.Agent = db.collection("Agent")
        this.dbCollections.ShipScan = db.collection("ShipScan")
        this.dbCollections.System = db.collection("System")
        this.dbCollections.Waypoint = db.collection("Waypoint")
        console.log(`Successfully connected to database: ${db.databaseName}`)
    }

    public async GetSystemRecord(systemSymbol: string, forceAPI: boolean = false) {

        let systemRecord = undefined

        let dbSystemRecord = await this.dbCollections.System.findOne({
            "data.symbol": systemSymbol
        })

        if ((!dbSystemRecord) || (forceAPI)) {
            let getSystemResponse = await this.systemApi.getSystem(systemSymbol)
            if (!dbSystemRecord) {
                systemRecord = {
                    firstRetrieved: new Date(),
                    lastRetrieved: new Date(),
                    data: getSystemResponse.data.data,
                }
                await this.dbCollections.System.insertOne(systemRecord)
            } else {
                dbSystemRecord.lastRetrieved = new Date()
                dbSystemRecord.data = getSystemResponse.data.data    
                await this.dbCollections.System.updateOne(
                    { _id: dbSystemRecord._id },
                    { $set: dbSystemRecord })
                    systemRecord = dbSystemRecord
            }
        } else {
            systemRecord = dbSystemRecord
        }

        return systemRecord
    }

    public async GetWaypointRecord(systemSymbol: string, waypointSymbol: string, forceAPI: boolean = false) {
    
        let waypointRecord = undefined
    
        let dbWaypointRecord = await this.dbCollections.Waypoint.findOne({
            "data.systemSymbol": systemSymbol,
            "data.symbol": waypointSymbol,
        })

        if ((!dbWaypointRecord) || (forceAPI)) {
            let getWaypointResponse = await this.systemApi.getWaypoint(systemSymbol, waypointSymbol)
            if (!dbWaypointRecord) {
                waypointRecord = {
                    firstRetrieved: new Date(),
                    lastRetrieved: new Date(),
                    data: getWaypointResponse.data.data,
                }
                await this.dbCollections.Waypoint.insertOne(waypointRecord)
            } else {
                dbWaypointRecord.lastRetrieved = new Date()
                dbWaypointRecord.data = getWaypointResponse.data.data    
                await this.dbCollections.Waypoint.updateOne(
                    { _id: dbWaypointRecord._id },
                    { $set: dbWaypointRecord })
                waypointRecord = dbWaypointRecord
            }
        } else {
            waypointRecord = dbWaypointRecord
        }
    
        return waypointRecord
    }

    public async GetAllSystemWaypoints (systemSymbol: string, forceAPI: boolean = false): Promise<Waypoint[]> {
        let getSystemResponse = await this.systemApi.getSystem(systemSymbol)
        let records: Waypoint[] = []
        for (let wp of getSystemResponse.data.data.waypoints) {
            let record = await this.GetWaypointRecord(systemSymbol, wp.symbol, forceAPI)
            records.push(record.data)
        }
        return records
    }
}