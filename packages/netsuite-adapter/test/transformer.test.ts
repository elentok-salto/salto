/*
*                      Copyright 2020 Salto Labs Ltd.
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
import { InstanceElement } from '@salto-io/adapter-api'
import { createInstanceElement, toNetsuiteRecord, Types } from '../src/transformer'
import {
  ATTRIBUTES, ENTITY_CUSTOM_FIELD, INTERNAL_ID, NETSUITE, RECORDS_PATH, SCRIPT_ID,
} from '../src/constants'
import { NetsuiteRecord } from '../src/client/client'

describe('Transformer', () => {
  const entityCustomFieldRecord = {
    label: 'My Custom Field Record',
    bla: false,
    [ATTRIBUTES]: {
      [INTERNAL_ID]: '111',
      'xsi:type': 'setupCustom:EntityCustomField',
    },
    owner: {
      [ATTRIBUTES]: {
        [INTERNAL_ID]: '222',
        'xsi:type': 'setupCustom:EntityCustomField',
      },
      name: 'I am the owner',
    },
  }

  describe('createInstanceElement func', () => {
    let inst: InstanceElement
    beforeAll(() => {
      inst = createInstanceElement(entityCustomFieldRecord,
        Types.customizationTypes[ENTITY_CUSTOM_FIELD])
      expect(inst).toBeDefined()
    })
    it('should omit values that are not stated in the type', async () => {
      expect(inst.value).not.toHaveProperty('bla')
    })

    it('should flatten ATTRIBUTES', async () => {
      expect(inst.value).not.toHaveProperty(ATTRIBUTES)
      expect(inst.value[INTERNAL_ID]).toEqual('111')
    })

    it('should flatten ATTRIBUTES of inner value', async () => {
      const { owner } = inst.value
      expect(owner).not.toHaveProperty(ATTRIBUTES)
      expect(owner[INTERNAL_ID]).toEqual('222')
      expect(owner.name).toEqual('I am the owner')
    })

    it('should transform primitive values ATTRIBUTES of inner value', async () => {
      expect(inst.value.label).toEqual('My Custom Field Record')
    })

    it('should create instance with correct name', async () => {
      expect(inst.elemID.name).toEqual('My_Custom_Field_Record')
    })
    it('should create correct path', async () => {
      expect(inst.path)
        .toEqual([NETSUITE, RECORDS_PATH, ENTITY_CUSTOM_FIELD, 'My_Custom_Field_Record'])
    })
  })

  describe('toNetsuiteRecord func', () => {
    let result: NetsuiteRecord
    beforeEach(() => {
      const instance = new InstanceElement('test', Types.customizationTypes[ENTITY_CUSTOM_FIELD], {
        label: 'Labelo',
        [INTERNAL_ID]: '123',
        [SCRIPT_ID]: 'my_script_id',
        owner: {
          [INTERNAL_ID]: '-5',
          name: 'Owner Name',
        },
      })
      result = toNetsuiteRecord(instance)
    })

    it('should transform INTERNAL_ID', () => {
      expect(result.internalId).toEqual('123')
    })

    it('should transform body fields', () => {
      expect(result.bodyFieldList).toHaveLength(3)
      expect(result.bodyFieldList).toMatchObject([
        {
          _name: 'label',
          _value: 'Labelo',
          _familyType: undefined,
          _typeName: undefined,
        },
        {
          _name: 'scriptId',
          _value: 'my_script_id',
          _familyType: undefined,
          _typeName: undefined,
        },
        {
          internalId: '-5',
          _name: 'owner',
        },
      ])
    })
  })
})
