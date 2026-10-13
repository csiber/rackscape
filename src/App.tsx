import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { useDataSource } from './data/source'

export default function App() {
  useDataSource()
  return (
    <>
      <Scene />
      <Hud />
    </>
  )
}
