import { parseCamundaForm } from '../camunda8';
import { parseFormFields } from '../operaton';

// The form fields of a user task, read from its BPMN model (STORY-082).

const model = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:operaton="http://operaton.org/schema/1.0/bpmn">
  <process id="p">
    <userTask id="first" name="اول" />
    <userTask id="review" name="بررسی">
      <extensionElements>
        <operaton:formData>
          <operaton:formField id="priority" label="اولویت &quot;کار&quot;" type="enum" defaultValue="low">
            <operaton:value id="low" name="کم" />
            <operaton:value id="high" name="زیاد" />
          </operaton:formField>
          <operaton:formField id="due" type="date">
            <operaton:validation><operaton:constraint name="required" /></operaton:validation>
          </operaton:formField>
          <operaton:formField id="file" label="پرونده" type="customType" />
        </operaton:formData>
      </extensionElements>
    </userTask>
  </process>
</definitions>`;

describe('form fields of a BPMN user task', () => {
  it('reads labels, types, choices, defaults and the required constraint', () => {
    expect(parseFormFields(model, 'review')).toEqual([
      {
        id: 'priority',
        label: 'اولویت "کار"',
        type: 'enum',
        required: false,
        defaultValue: 'low',
        options: [
          { id: 'low', name: 'کم' },
          { id: 'high', name: 'زیاد' },
        ],
      },
      { id: 'due', label: null, type: 'date', required: true, defaultValue: null, options: [] },
      // A type the inbox does not know is shown as text.
      { id: 'file', label: 'پرونده', type: 'string', required: false, defaultValue: null, options: [] },
    ]);
  });

  it('gives no fields for a task without a form or not in the model', () => {
    expect(parseFormFields(model, 'first')).toEqual([]);
    expect(parseFormFields(model, 'missing')).toEqual([]);
  });
});

describe('parseCamundaForm', () => {
  const schema = {
    id: 'review',
    components: [
      { type: 'text', text: '# بررسی' },
      { type: 'checkbox', key: 'approved', label: 'تأیید؟' },
      { type: 'textfield', key: 'note', label: 'یادداشت', validate: { required: true } },
      {
        type: 'group',
        components: [
          { type: 'number', key: 'amount', label: 'مبلغ', defaultValue: 10 },
          {
            type: 'select',
            key: 'priority',
            label: 'اولویت',
            values: [
              { label: 'کم', value: 'low' },
              { label: 'زیاد', value: 'high' },
            ],
          },
        ],
      },
      { type: 'checklist', key: 'tags', label: 'برچسب‌ها', values: [{ label: 'الف', value: 'a' }] },
      { type: 'datetime', key: 'due', subtype: 'date' },
      { type: 'textfield', label: 'بدون کلید' },
    ],
  };

  it('reads the inputs with a key, also inside groups, and leaves out lists and display components; a checkbox is a required yes or no', () => {
    expect(parseCamundaForm(JSON.stringify(schema))).toEqual([
      { id: 'approved', label: 'تأیید؟', type: 'boolean', required: true, defaultValue: null, options: [] },
      { id: 'note', label: 'یادداشت', type: 'string', required: true, defaultValue: null, options: [] },
      { id: 'amount', label: 'مبلغ', type: 'long', required: false, defaultValue: '10', options: [] },
      {
        id: 'priority',
        label: 'اولویت',
        type: 'enum',
        required: false,
        defaultValue: null,
        options: [
          { id: 'low', name: 'کم' },
          { id: 'high', name: 'زیاد' },
        ],
      },
      { id: 'due', label: null, type: 'date', required: false, defaultValue: null, options: [] },
    ]);
  });

  it('gives no fields for no form or a broken one', () => {
    expect(parseCamundaForm(null)).toEqual([]);
    expect(parseCamundaForm('{not json')).toEqual([]);
    expect(parseCamundaForm({ components: [] })).toEqual([]);
  });
});
