import * as Canvas from 'canvas'
import * as fs from 'fs'
//import * as vr from 'voronoi'
import { Voronoi, BoundingBox, Site, Diagram } from 'voronoijs'
import { System, Waypoint, WaypointType } from '../packages/spacetraders-sdk'
import { Vector } from 'ts-matrix'
import _ = require('lodash')

// https://stackoverflow.com/questions/33599688/how-to-use-es8-async-await-with-streams

let factionColors = {
    "COSMIC"  : "#000099", // dark blue
    "UNITED"  : "#009900", // dark green
    "QUANTUM" : "#00FF00", // green
    "ASTRO"   : "#999900", // dark yellow
    "VOID"    : "#0000FF", // blue
    "CORSAIRS": "#FFFF00", // yellow
    "SOLITARY": "#FF0000", // red
    "DOMINION": "#009999", // teal
    "GALACTIC": "#990000", // dark red
    "OBSIDIAN": "#6abe30",
    "AEGIS"   : "#37946e",
    "COBALT"  : "#df7126",
    "OMEGA"   : "#d9a066",
    "ECHO"    : "#eec39a",
    "LORDS"   : "#306082",
    "CULT"    : "#5b6ee1",
    "ANCIENTS": "#639bff",
    "SHADOW"  : "#5fcde4",
    "ETHEREAL": "#d77bba",
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
    "PLANET"         : 'green',
    "GAS_GIANT"      : "#FFE4B5",
    "MOON"           : "#B2BEB5",
    "ORBITAL_STATION": undefined,
    "JUMP_GATE"      : undefined,
    "ASTEROID_FIELD" : 'brown',
    "NEBULA"         : "#5D3FD3",
    "DEBRIS_FIELD"   : undefined,
    "GRAVITY_WELL"   : undefined,
}

export function DrawGalaxy(data: System[], folderPath?: string, filename?: string) {
    
    if (folderPath === undefined) {
        folderPath = "./render/"
    }

    if (filename === undefined) {
        filename = `galaxy.png`
    }

    const fullPath: string = folderPath + filename

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

    //const scaleFactor = 0.25
    //const scaleFactor = 0.6
    //const scaleFactor = 0.1
    const scaleFactor = 0.08
    let padding = 50
    minpoint.x = (minpoint.x * scaleFactor) - padding
    maxpoint.x = (maxpoint.x * scaleFactor) + padding
    minpoint.y = (minpoint.y * scaleFactor) - padding
    maxpoint.y = (maxpoint.y * scaleFactor) + padding

    const halfCanvasWidth = Math.max(Math.abs(minpoint.x), maxpoint.x)
    const halfCanvasHeight = Math.max(Math.abs(minpoint.y), maxpoint.y)
    const canvasWidth = halfCanvasWidth * 2
    const canvasHeight = halfCanvasHeight * 2

    //console.log(minpoint)
    //console.log(maxpoint)
    console.log(canvasWidth, canvasHeight)

    let voronoi = new Voronoi();
    let bbox: BoundingBox = { xl: 0, xr: canvasWidth, yt: 0, yb: canvasHeight }
    let sites: Site[] = []

    for (let x = 0; x < data.length; x++) {
        let entry = data[x]
        entry.x = (entry.x * scaleFactor) + halfCanvasWidth
        entry.y = (entry.y * scaleFactor) + halfCanvasHeight
        //if (entry.waypoints.findIndex(x => x.type == WaypointType.JumpGate) != -1) {
            sites.push({ id: 0, x: entry.x, y: entry.y })
        //}
    }
    
    let diagram: Diagram = voronoi.compute(sites, bbox);

    // NOTE: createCanvas max size is 32,767
    const canvas = Canvas.createCanvas(canvasWidth, canvasHeight)
    const ctx = canvas.getContext("2d")
    const defaultAntialias = ctx.antialias
    
    // background color
    {
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, canvasWidth,canvasHeight)
    }

    // voronoi cells
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
            //ctx.fillStyle = "#333333"//factionColors[dataEntry.factionSymbol] ?? "#333333"
            
            if (_.has(dataEntry, 'factions') && dataEntry.factions.length != 0) {
                ctx.fillStyle = factionColors[dataEntry.factions[0].symbol] ?? "white"
            } else {
                ctx.fillStyle = "#333333"
            }
            
            ctx.antialias = "none"
            ctx.fill()
            ctx.antialias = defaultAntialias
        }
    })

    // voronoi edges
    /*{
        ctx.strokeStyle = 'black'
        ctx.lineWidth = 2
        diagram.edges.forEach(edge => {
            ctx.beginPath()
            ctx.moveTo(edge.va.x, edge.va.y)
            ctx.lineTo(edge.vb.x, edge.vb.y)
            ctx.stroke()
        })
    }*/

    // center cross
    /*{
        ctx.lineWidth = 0
        ctx.fillStyle = 'white'
        ctx.antialias = "none"
        ctx.fillRect(halfCanvasWidth, 0, 1, canvasHeight)
        ctx.fillRect(0, halfCanvasHeight, canvasWidth, 1)
        ctx.antialias = defaultAntialias
    }*/
    
    // planets
    for (let entry of data) {
        /*if (entry.waypoints.findIndex(x => x.type == WaypointType.JumpGate) != -1) {
            let radius = 10
            ctx.beginPath()
            ctx.arc(entry.x, entry.y, radius, 0, 2 * Math.PI, false)
            ctx.fillStyle = starColors[entry.type] ?? 'white'
            ctx.fill()
            ctx.lineWidth = 2
            //ctx.strokeStyle = factionColors[entry.factionSymbol] ?? "#333333"
            //ctx.strokeStyle = factionColors[entry.factions[0]?.symbol] ?? "#333333"
            ctx.stroke()
        }*/

        ctx.lineWidth = 0
        ctx.fillStyle = 'black'
        ctx.antialias = "none"
        ctx.fillRect(entry.x - 1, entry.y, 3, 1)
        ctx.fillRect(entry.x, entry.y - 1, 1, 3)
        ctx.antialias = defaultAntialias
    }

    console.log("DrawGalaxy: Writing to strean")
    const out = fs.createWriteStream(fullPath)
    const stream = canvas.createPNGStream()
    stream.pipe(out)
    console.log("DrawGalaxy: Finished")

    {
        const slizeSize = 2048
        let imageData = ctx.getImageData(halfCanvasWidth - (slizeSize/2), halfCanvasHeight - (slizeSize/2), slizeSize, slizeSize)
        const sliceCanvas = Canvas.createCanvas(slizeSize, slizeSize)
        const sliceCtx = sliceCanvas.getContext("2d")
        sliceCtx.putImageData(imageData, 0, 0)
        const sliceOut = fs.createWriteStream(`${folderPath}slice.png`)
        const sliceStream = sliceCanvas.createPNGStream()
        sliceStream.pipe(sliceOut)
    }
    
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
    const padding = 150
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
    const ctx: Canvas.CanvasRenderingContext2D = canvas.getContext("2d")

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
        const starRadius = 28
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
            ctx.setLineDash([])
        }

        const primaryWaypointRadius = 15
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

        if (waypoint.type == WaypointType.JumpGate) {
            //DrawTriangle(ctx, halfCanvasWidth + positionX, halfCanvasHeight + positionY)
            DrawPolygon(ctx, 3, radius, halfCanvasWidth + positionX, halfCanvasHeight + positionY)
        } else if (waypoint.type == WaypointType.OrbitalStation) {
            DrawPolygon(ctx, 6, radius, halfCanvasWidth + positionX, halfCanvasHeight + positionY)
        } else {
            ctx.beginPath()
            ctx.arc(halfCanvasWidth + positionX, halfCanvasHeight + positionY, radius, 0, 2 * Math.PI, false)
            ctx.fillStyle = waypointColors[waypoint.type] ?? waypointDefaultFillColor
            ctx.fill()
            ctx.lineWidth = 2
            ctx.strokeStyle = waypointStrokeColor
            ctx.stroke()
        }

        const label: string = `${waypoint.symbol}`

        //ctx.font = '15px Cascade Mono'
        //ctx.font = 'bold 15px sans-serif'
        ctx.font = 'bold 15px monospace'
        const textMetrics = ctx.measureText(label)
        const textHeight = textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent
        ctx.translate(halfCanvasWidth + positionX, halfCanvasHeight + positionY)
        ctx.rotate(45)
        ctx.fillStyle = 'white'
        ctx.fillText(label, primaryWaypointRadius + 4, textHeight/2)
        //ctx.fillText(label, 0, 0)
        ctx.resetTransform()
    }

    // title
    {
        const titleString: string = `${system.symbol} | X${system.x} Y${system.y} | ${system.type} | ${system.waypoints.length} waypoints`

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

function DrawTriangle(ctx: Canvas.CanvasRenderingContext2D, centerX: number, centerY: number) {
    //ctx.fillStyle = 'black'
    //ctx.fillRect(centerX, centerY, centerX + 10, centerY + 10)

    const radius = 10
    let point1 = PointOnCircle(radius, 0)
    let point2 = PointOnCircle(radius, 120)
    let point3 = PointOnCircle(radius, 240)
    ctx.beginPath()
    ctx.moveTo(centerX + point1.x, centerY + point1.y)
    ctx.lineTo(centerX + point2.x, centerY + point2.y)
    ctx.lineTo(centerX + point3.x, centerY + point3.y)
    ctx.closePath()
    ctx.fillStyle = 'blue'
    ctx.lineWidth = 2
    ctx.strokeStyle = 'black'
    ctx.fill()
    ctx.stroke()
}

function DrawPolygon(ctx: Canvas.CanvasRenderingContext2D, sides: number, radius: number, centerX: number, centerY: number) {
    ctx.beginPath()
    for (let x: number = 0; x < 360; x += (360 / sides)) {
        let p = PointOnCircle(radius, x)
        if (x == 0) {
            ctx.moveTo(centerX + p.x, centerY + p.y)
        } else {
            ctx.lineTo(centerX + p.x, centerY + p.y)
        }
    }
    ctx.closePath()
    ctx.fillStyle = 'blue'
    ctx.lineWidth = 2
    ctx.strokeStyle = 'black'
    ctx.fill()
    ctx.stroke()
}

function VectorLength(x: number, y:number): number {
    return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2))
}

function PointOnCircle(radius: number, deg: number) {
    let x = Math.sin(deg * (Math.PI/180)) * radius
    let y = Math.cos(deg * (Math.PI/180)) * radius
    return { x: x, y: y }
}