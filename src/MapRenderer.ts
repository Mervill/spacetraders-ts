import * as Canvas from 'canvas'
import * as fs from 'fs'
//import * as vr from 'voronoi'
import { Voronoi, BoundingBox, Site, Diagram } from 'voronoijs'

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

    const canvasWidth = Math.abs(minpoint.x) + maxpoint.x
    const canvasHeight = Math.abs(minpoint.y) + maxpoint.y
    const halfCanvasWidth = canvasWidth / 2
    const halfCanvasHeight = canvasHeight / 2

    console.log(minpoint)
    console.log(maxpoint)
    console.log(canvasWidth, canvasHeight)

    let voronoi = new Voronoi();
    let bbox: BoundingBox = { xl: 0, xr: canvasWidth, yt: 0, yb: canvasHeight }
    let sites: Site[] = []

    for (let x = 0; x < data.length; x++) {
        let entry = data[x]
        //entry.x += halfCanvasWidth
        //entry.y += halfCanvasHeight
        sites.push({ id: 0, x: entry.x, y: entry.y })
    }

    let diagram: Diagram = voronoi.compute(sites, bbox);

    const canvas = Canvas.createCanvas(canvasWidth, canvasHeight)
    const ctx = canvas.getContext("2d")

    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvasWidth,canvasHeight)

    ctx.lineWidth = 0
    ctx.fillStyle = 'white'
    //ctx.strokeStyle = 'white'

    //let seenFactions = {}
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

            //let faction = data[cell.site.id].factionSymbol
            //seenFactions[faction] = 1
            //ctx.fillStyle = factionColors[faction] ?? "black"
            ctx.fillStyle = factionColors[dataEntry.factionSymbol] ?? "#333333"
            ctx.fill()
            //ctx.stroke()
        }
    })

    //console.log(JSON.stringify(seenFactions, undefined, 2))
    ctx.strokeStyle = 'black'
    ctx.lineWidth = 2
    diagram.edges.forEach(edge => {
        ctx.beginPath()
        ctx.moveTo(edge.va.x, edge.va.y)
        ctx.lineTo(edge.vb.x, edge.vb.y)
        ctx.stroke()
    })

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

    for (let entry of data) {
        let radius = 10
        ctx.beginPath()
        ctx.arc(entry.x, entry.y, radius, 0, 2 * Math.PI, false)
        ctx.fillStyle = 'white'
        if (entry.symbol == "X1-ZA40") {
            ctx.fillStyle = 'green'
        }
        if (entry.symbol == "X1-HN46") {
            ctx.fillStyle = 'red'
        }
        ctx.fill()
        ctx.lineWidth = 2
        //ctx.strokeStyle = factionColors[entry.factionSymbol] ?? "#333333"
        ctx.strokeStyle = 'black'
        ctx.stroke()
    }

    const out = fs.createWriteStream(filename)
    const stream = canvas.createPNGStream()
    stream.pipe(out)
}