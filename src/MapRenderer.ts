import * as Canvas from 'canvas'
import * as fs from 'fs'
//import * as vr from 'voronoi'
import { Voronoi, BoundingBox, Site, Diagram } from 'voronoijs'
import { System, Waypoint } from '../packages/spacetraders-sdk'
import { Vector } from 'ts-matrix'

let factionColors = {
    "COSMIC"  : "#000099", // blue
    "UNITED"  : "#009900", // green
    "QUANTUM" : "#00FF00", // dark green
    "ASTRO"   : "#999900",
    "VOID"    : "#0000FF",
    "CORSAIRS": "#FFFF00",
    "SOLITARY": "#FF0000",
    "DOMINION": "#009999",
    "GALACTIC": "#990000",
}

let starColors = {
    "NEUTRON_STAR": "#7DF9FF",
    "RED_STAR"    : "#EE4B2B",
    "ORANGE_STAR" : "#FFAC1C",
    "BLUE_STAR"   : "#6495ED",
    "YOUNG_STAR"  : "#FFEA00",
    "WHITE_DWARF" : "#e3e4e6",
    "BLACK_HOLE"  : "#0A0B0C",
    "HYPERGIANT"  : "#C04000",
    "NEBULA"      : "#5D3FD3",
    "UNSTABLE"    : "#28282B",
}

let waypointColors = {
    "PLANET"         : "",
    "GAS_GIANT"      : "",
    "MOON"           : "",
    "ORBITAL_STATION": "",
    "JUMP_GATE"      : "",
    "ASTEROID_FIELD" : "",
    "NEBULA"         : "",
    "DEBRIS_FIELD"   : "",
    "GRAVITY_WELL"   : "",
}

export function Render(data: Array<any>, filename: string) {
    
    console.log(`data: ${data.length}`)
    
    /*ctx.font = '30px Impact'
    ctx.rotate(0.1)
    ctx.fillText('Awesome!', 50, 100)

    let text = ctx.measureText('Awesome!')
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.beginPath()
    ctx.lineTo(50, 102)
    ctx.lineTo(50 + text.width, 102)
    ctx.stroke()*/

    let minpoint = { x: 0, y: 0 }
    let maxpoint = { x: 0, y: 0 }
    for (let entry of data) {
        if (entry.x < minpoint.x) {
            minpoint.x = entry.x
        }
        if (entry.y < minpoint.y) {
            minpoint.y = entry.y
        }

        if (entry.x > maxpoint.x) {
            maxpoint.x = entry.x
        }
        if (entry.y > maxpoint.y) {
            maxpoint.y = entry.y
        }
    }

    let stdPadding = 50
    minpoint.x -= stdPadding
    maxpoint.x += stdPadding
    minpoint.y -= stdPadding
    maxpoint.y += stdPadding

    const halfCanvasWidth = Math.max(Math.abs(minpoint.x), maxpoint.x)
    const halfCanvasHeight = Math.max(Math.abs(minpoint.y), maxpoint.y)
    const canvasWidth = halfCanvasWidth * 2
    const canvasHeight = halfCanvasHeight * 2

    //const canvasWidth = Math.abs(minpoint.x) + maxpoint.x
    //const canvasHeight = Math.abs(minpoint.y) + maxpoint.y
    //const halfCanvasWidth = canvasWidth / 2
    //const halfCanvasHeight = canvasHeight / 2

    console.log(minpoint)
    console.log(maxpoint)
    console.log(canvasWidth, canvasHeight)

    let voronoi = new Voronoi();
    let bbox: BoundingBox = { xl: 0, xr: canvasWidth, yt: 0, yb: canvasHeight }
    let sites: Site[] = []

    for (let x = 0; x < data.length; x++) {
        let entry = data[x]
        entry.x += halfCanvasWidth
        entry.y += halfCanvasHeight
        sites.push({ id: 0, x: entry.x, y: entry.y })
    }

    let diagram: Diagram = voronoi.compute(sites, bbox);

    const canvas = Canvas.createCanvas(canvasWidth, canvasHeight)
    const ctx = canvas.getContext("2d")

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvasWidth,canvasHeight)

    //ctx.lineWidth = 0
    //ctx.fillStyle = 'white'
    //ctx.strokeStyle = 'white'

    diagram.cells.forEach(cell => {
        if (cell && cell.halfedges.length > 2) {
            const segments = cell.halfedges.map(edge => edge.getEndpoint());
            ctx.beginPath()
            ctx.moveTo(segments[0].x, segments[0].y)
            for (let x = 1; x < segments.length; x++) {
                ctx.lineTo(segments[x].x, segments[x].y)
            }
            ctx.closePath()

            let dataEntry = data.find(e => (e.x == cell.site.x) && (e.y == cell.site.y))
            ctx.fillStyle = factionColors[dataEntry.factionSymbol] ?? "#333333"
            ctx.fill()
        }
    })

    ctx.strokeStyle = 'black'
    ctx.lineWidth = 2
    diagram.edges.forEach(edge => {
        ctx.beginPath()
        ctx.moveTo(edge.va.x, edge.va.y)
        ctx.lineTo(edge.vb.x, edge.vb.y)
        ctx.stroke()
    })

    /*
    ctx.strokeStyle = 'white'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(halfCanvasWidth, 0)
    ctx.lineTo(halfCanvasWidth, canvasHeight)
    ctx.stroke()

    ctx.strokeStyle = 'white'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, halfCanvasHeight)
    ctx.lineTo(canvasWidth, halfCanvasHeight)
    ctx.stroke()
    */

    ctx.lineWidth = 0
    ctx.fillStyle = 'white'
    ctx.fillRect(halfCanvasWidth, 0, 1, canvasHeight)
    ctx.fillRect(0, halfCanvasHeight, canvasWidth, 1)

    for (let entry of data) {
        let radius = 10
        ctx.beginPath()
        ctx.arc(entry.x, entry.y, radius, 0, 2 * Math.PI, false)
        ctx.fillStyle = 'white'
        if (entry.symbol == "X1-ZA40") {
            ctx.fillStyle = 'green'
        }
        if (entry.symbol == "X1-HN46") {
            ctx.fillStyle = 'yellow'
        }
        ctx.fill()
        ctx.lineWidth = 2
        //ctx.strokeStyle = factionColors[entry.factionSymbol] ?? "#333333"
        ctx.strokeStyle = 'black'
        ctx.stroke()

        ctx.lineWidth = 0
        ctx.fillStyle = 'black'
        //ctx.beginPath()
        ctx.fillRect(entry.x - 1, entry.y, 3, 1)
        ctx.fillRect(entry.x, entry.y - 1, 1, 3)
        //ctx.stroke()
    }

    const out = fs.createWriteStream(filename)
    const stream = canvas.createPNGStream()
    stream.pipe(out)
}

export function DrawSystem(system: System, folderPath?: string, filename?: string) {

    const mainBGColor = '#6e6e6e'
    const waypointDefaultFillColor = 'white'
    const waypointStrokeColor = 'black'
    const orbitLineColor = 'black'

    if (folderPath === undefined) {
        folderPath = "./render/"
    }

    if (filename === undefined) {
        filename = `System-${system.symbol}.png`
    }

    // TODO: file extension must be png

    const fullPath: string = folderPath + filename

    let minpoint = { x: 0, y: 0 }
    let maxpoint = { x: 0, y: 0 }
    for (let waypoint of system.waypoints) {
        if (waypoint.x < minpoint.x) {
            minpoint.x = waypoint.x
        }
        if (waypoint.y < minpoint.y) {
            minpoint.y = waypoint.y
        }

        if (waypoint.x > maxpoint.x) {
            maxpoint.x = waypoint.x
        }
        if (waypoint.y > maxpoint.y) {
            maxpoint.y = waypoint.y
        }
    }
    console.log(minpoint, maxpoint)

    const scaleFactor = 10
    const padding = 100
    minpoint.x = (minpoint.x * scaleFactor) - padding
    maxpoint.x = (maxpoint.x * scaleFactor) + padding
    minpoint.y = (minpoint.y * scaleFactor) - padding
    maxpoint.y = (maxpoint.y * scaleFactor) + padding

    const halfCanvasWidth = Math.max(Math.abs(minpoint.x), maxpoint.x)
    const halfCanvasHeight = Math.max(Math.abs(minpoint.y), maxpoint.y)
    const canvasWidth = halfCanvasWidth * 2
    const canvasHeight = halfCanvasHeight * 2

    for (let waypoint of system.waypoints) {
        waypoint.x = (waypoint.x * scaleFactor)
        waypoint.y = (waypoint.y * scaleFactor)
    }

    const canvas = Canvas.createCanvas(canvasWidth, canvasHeight)
    const ctx = canvas.getContext("2d")

    // background color
    {
        ctx.fillStyle = mainBGColor
        ctx.fillRect(0, 0, canvasWidth, canvasHeight)
    }

    // center cross
    {
        ctx.lineWidth = 0
        ctx.fillStyle = 'black'
        ctx.fillRect(halfCanvasWidth, 0, 1, canvasHeight)
        ctx.fillRect(0, halfCanvasHeight, canvasWidth, 1)
    }

    // star
    {
        const starRadius = 20
        ctx.beginPath()
        ctx.arc(halfCanvasWidth, halfCanvasHeight, starRadius, 0, 2 * Math.PI, false)
        ctx.fillStyle = starColors[system.type] ?? waypointDefaultFillColor
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = waypointStrokeColor
        ctx.stroke()
    }

    console.log(`Drawing ${system.waypoints.length} waypoints...`)
    let orbitKeys = {}
    for (const waypoint of system.waypoints) {

        let isSubObject = false
        const ok = `${waypoint.x},${waypoint.y}`
        if (orbitKeys[ok] === undefined) {
            orbitKeys[ok] = 0
        } else {
            isSubObject = true
            orbitKeys[ok]++
        }

        if (!isSubObject) {
            const origin: Vector = new Vector([ waypoint.x, waypoint.y ])
            ctx.beginPath()
            ctx.arc(halfCanvasWidth, halfCanvasHeight, origin.length(), 0, 2 * Math.PI, false)
            ctx.setLineDash([10])
            ctx.lineWidth = 2
            ctx.strokeStyle = orbitLineColor
            ctx.stroke()
        }

        const primaryWaypointRadius = 10
        let radius = primaryWaypointRadius
        let positionX = waypoint.x
        let positionY = waypoint.y

        const subobjectPadding = 2
        if (isSubObject) {
            radius /= 2
            let offset = 0
            // this line deals with the seperation between the subobjects
            offset += (((radius + subobjectPadding) * 2) * (orbitKeys[ok] - 1))
            // this line deals with the offset from the primary object
            offset += (primaryWaypointRadius + radius) + (subobjectPadding * 2)

            // we want to draw subobjects 'towards' the center of the image
            if ((positionX + halfCanvasWidth) > halfCanvasWidth) {
                positionX -= offset
            } else {
                positionX += offset
            }
        }

        ctx.beginPath()
        ctx.arc(halfCanvasWidth + positionX, halfCanvasHeight + positionY, radius, 0, 2 * Math.PI, false)
        ctx.fillStyle = waypointDefaultFillColor
        ctx.fill()
        ctx.setLineDash([])
        ctx.lineWidth = 2
        ctx.strokeStyle = waypointStrokeColor
        ctx.stroke()
    }

    // title
    {
        const titleString: string = `${system.symbol} [${system.x} ${system.y}]`

        //ctx.font = '30px Impact'
        //ctx.font = '30px Mono'
        ctx.font = '30px Cascade Mono'
        const textMetrics = ctx.measureText(titleString)
        const textHeight = textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent

        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvasWidth, textHeight + 20)

        ctx.beginPath()
        ctx.moveTo(0, textHeight + 20)
        ctx.lineTo(canvasWidth, textHeight + 20)
        ctx.lineWidth = 2
        ctx.strokeStyle = 'black'
        ctx.stroke()

        ctx.fillStyle = 'black'
        ctx.fillText(titleString, 10, textHeight + 10)
    }

    const out = fs.createWriteStream(fullPath)
    const stream = canvas.createPNGStream()
    stream.pipe(out)
    console.log(`[DrawSystem] Wrote ${fullPath}`)
}

function VectorLength(x: number, y:number): number {
    return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2))
}