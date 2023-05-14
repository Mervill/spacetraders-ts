import {
    ShipNavFlightMode
} from './packages/spacetraders-sdk'

// FLIGHT MODE
// DRIFT, STEALTH, CRUISE, BURN
// DR     ST       CR      BU

export function ShortenShipNavFlightMode(value: ShipNavFlightMode): string {
    return value.substring(0, 2)
}