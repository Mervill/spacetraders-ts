import { Ship } from "../packages/spacetraders-sdk"

//export type TaskCode = AsyncGenerator<number, void, unknown>

export type TaskCode<T> = (ships: Ship[], payload: T) => AsyncGenerator<number, void, unknown>

export class Task {
    ships: Ship[]
    code: TaskCode<any>
}

export class TaskManager {
    
    tasks: Task[]

    public async run<T>(code: TaskCode<T>, ships: Ship[], payload: T) {
        let taskGenerator = code(ships, payload)
        while (true) {
            const out = await taskGenerator.next()
            console.log("... yield")
            if (out.done) {
                break
            }
        }
    }

}