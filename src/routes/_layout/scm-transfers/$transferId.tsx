import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/scm-transfers/$transferId')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_layout/scm-transfers/$transferId"!</div>
}
