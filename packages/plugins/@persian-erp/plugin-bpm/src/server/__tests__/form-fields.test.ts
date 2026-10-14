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
