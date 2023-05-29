import {
    ShipNavFlightMode
} from './packages/spacetraders-sdk'

// FLIGHT MODE
// DRIFT, STEALTH, CRUISE, BURN
// DR     ST       CR      BU

export function ShortenShipNavFlightMode(value: ShipNavFlightMode): string {
    return value.substring(0, 2)
}

export function ISOTimeStamp(): string {
    return (new Date().toISOString())
}

export function SplitShipSymbol(shipSymbol: string) {
    let seperatorPosition = shipSymbol.lastIndexOf("-")
    let agentName = shipSymbol.substring(0, seperatorPosition)
    let shipNumber = shipSymbol.substring(seperatorPosition + 1)
    return { AgentName: agentName, ShipNumber: shipNumber }
}