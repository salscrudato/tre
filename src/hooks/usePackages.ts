import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Package } from '../types'
import {
  createPackage,
  deletePackage,
  listPackages,
  updatePackage,
  type PackagePatch,
  type PackageWrite,
} from '../services/packages'

const KEY = ['packages'] as const

// Stable empty fallback (see useCategories) so `packages` keeps one reference while
// loading.
const EMPTY_PACKAGES = Object.freeze([]) as unknown as Package[]

export function usePackages() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listPackages })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: PackageWrite) => createPackage(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: PackagePatch }) => updatePackage(vars.id, vars.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deletePackage(id),
    onSuccess: invalidate,
  })

  return {
    packages: query.data ?? EMPTY_PACKAGES,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    remove,
  }
}
