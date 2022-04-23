/*
*                      Copyright 2022 Salto Labs Ltd.
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with
* the License.  You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/
import { AdditionChange, CORE_ANNOTATIONS, Element, getChangeData, InstanceElement, isInstanceElement, isModificationChange, ModificationChange, Values } from '@salto-io/adapter-api'
import { logger } from '@salto-io/logging'
import { createSchemeGuard, resolveChangeElement } from '@salto-io/adapter-utils'
import _ from 'lodash'
import Joi from 'joi'
import { FilterCreator } from '../../filter'
import { BOARD_COLUMN_CONFIG_TYPE, BOARD_TYPE_NAME } from '../../constants'
import { addAnnotationRecursively, findObject, setFieldDeploymentAnnotations } from '../../utils'
import JiraClient from '../../client/client'
import { getLookUpName } from '../../reference_mapping'

const KANBAN_TYPE = 'kanban'
export const COLUMNS_CONFIG_FIELD = 'columnConfig'

const log = logger(module)

type UpdateColumnsResponse = {
  mappedColumns: {
    name: string
  }[]
}

const UPDATE_COLUMNS_RESPONSE_SCHEME = Joi.object({
  mappedColumns: Joi.array().items(Joi.object({
    name: Joi.string().required(),
  }).unknown(true)).required(),
}).unknown(true).required()

const isUpdateColumnsResponse = createSchemeGuard<UpdateColumnsResponse>(UPDATE_COLUMNS_RESPONSE_SCHEME, 'Received an invalid columns update response')

const convertColumn = (column: Values): Values => ({
  name: column.name,
  mappedStatuses: (column.statuses ?? []).map((id: string) => ({ id })),
  min: column.min ?? '',
  max: column.max ?? '',
})

export const deployColumns = async (
  change: AdditionChange<InstanceElement> | ModificationChange<InstanceElement>,
  client: JiraClient,
  retriesLeft: number,
): Promise<void> => {
  const resolvedChange = await resolveChangeElement(change, getLookUpName)

  if (isModificationChange(resolvedChange)
  && _.isEqual(
    resolvedChange.data.before.value[COLUMNS_CONFIG_FIELD],
    resolvedChange.data.after.value[COLUMNS_CONFIG_FIELD]
  )) {
    return
  }

  const instance = getChangeData(resolvedChange)

  const response = await client.putPrivate({
    url: '/rest/greenhopper/1.0/rapidviewconfig/columns',
    data: {
      currentStatisticsField: {
        id: instance.value[COLUMNS_CONFIG_FIELD].constraintType !== undefined
          ? `${instance.value[COLUMNS_CONFIG_FIELD].constraintType}_`
          : 'none_',
      },
      rapidViewId: instance.value.id,
      mappedColumns: instance.value[COLUMNS_CONFIG_FIELD].columns.map(convertColumn),
    },
  })

  if (!isUpdateColumnsResponse(response.data)) {
    throw new Error(`Received an invalid response from Jira when updating the columns of ${instance.elemID.getFullName()}`)
  }

  const columnsToUpdate = instance.value[COLUMNS_CONFIG_FIELD].columns
    .map(({ name }: Values) => name)

  const updatedColumns = response.data.mappedColumns.map(({ name }) => name)
  if (instance.value.type === KANBAN_TYPE) {
    // In Kanban boards, the first column is always backlog, which is non-editable.
    updatedColumns.shift()
  }

  if (!_.isEqual(columnsToUpdate, updatedColumns)) {
    log.warn(`Failed to update columns of ${instance.elemID.getFullName()} - ${updatedColumns.join(', ')}`)
    if (retriesLeft > 0) {
      await deployColumns(change, client, retriesLeft - 1)
    } else {
      throw new Error(`Failed to update columns of ${instance.elemID.getFullName()}`)
    }
  }
}

const filter: FilterCreator = ({ config }) => ({
  onFetch: async (elements: Element[]) => {
    elements
      .filter(isInstanceElement)
      .filter(instance => instance.elemID.typeName === BOARD_TYPE_NAME)
      .forEach(instance => {
        instance.value[COLUMNS_CONFIG_FIELD] = instance.value.config[COLUMNS_CONFIG_FIELD]
        delete instance.value.config[COLUMNS_CONFIG_FIELD]

        instance.value[COLUMNS_CONFIG_FIELD].columns.forEach((column: Values) => {
          if (column.statuses !== undefined) {
            column.statuses = column.statuses.map((status: Values) => status.id)
          }
        })

        if (instance.value.type === KANBAN_TYPE) {
          // In Kanban boards, the first column is always backlog, which is non-editable.
          // Not removing it will make us create another backlog column.
          instance.value[COLUMNS_CONFIG_FIELD].columns = instance.value[COLUMNS_CONFIG_FIELD]
            .columns.slice(1)
        }
      })

    if (!config.client.usePrivateAPI) {
      log.debug('Skipping board columns filter because private API is not enabled')
      return
    }

    const columnConfigType = findObject(elements, BOARD_COLUMN_CONFIG_TYPE)
    const boardType = findObject(elements, BOARD_TYPE_NAME)

    if (columnConfigType === undefined || boardType === undefined) {
      return
    }

    setFieldDeploymentAnnotations(boardType, COLUMNS_CONFIG_FIELD)
    await addAnnotationRecursively(columnConfigType, CORE_ANNOTATIONS.CREATABLE)
    await addAnnotationRecursively(columnConfigType, CORE_ANNOTATIONS.UPDATABLE)
  },
})

export default filter