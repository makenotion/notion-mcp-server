import { describe, it, expect } from 'vitest';
import { normalizeRichTextObjects, normalizeRequestPayload } from '../request-normalizer';

describe('normalizeRichTextObjects', () => {
  it('should handle null and undefined values', () => {
    expect(normalizeRichTextObjects(null)).toBeNull();
    expect(normalizeRichTextObjects(undefined)).toBeUndefined();
  });

  it('should pass through non-object values', () => {
    expect(normalizeRichTextObjects('test')).toBe('test');
    expect(normalizeRichTextObjects(123)).toBe(123);
    expect(normalizeRichTextObjects(true)).toBe(true);
  });

  it('should move annotations from text.annotations to root level', () => {
    const input = {
      rich_text: [
        {
          type: 'text',
          text: {
            content: 'Save recording...',
            annotations: {
              color: 'gray'
            }
          }
        }
      ]
    };

    const expected = {
      rich_text: [
        {
          type: 'text',
          text: {
            content: 'Save recording...'
          },
          annotations: {
            color: 'gray'
          }
        }
      ]
    };

    expect(normalizeRichTextObjects(input)).toEqual(expected);
  });

  it('should handle nested objects with rich_text arrays', () => {
    const input = {
      toggle: {
        children: [
          {
            numbered_list_item: {
              rich_text: [
                {
                  text: {
                    content: 'Save recording...',
                    annotations: {
                      color: 'gray'
                    }
                  },
                  type: 'text'
                }
              ]
            }
          }
        ]
      }
    };

    const expected = {
      toggle: {
        children: [
          {
            numbered_list_item: {
              rich_text: [
                {
                  text: {
                    content: 'Save recording...'
                  },
                  annotations: {
                    color: 'gray'
                  },
                  type: 'text'
                }
              ]
            }
          }
        ]
      }
    };

    expect(normalizeRichTextObjects(input)).toEqual(expected);
  });

  it('should process rich_text arrays inside children arrays', () => {
    const input = {
      children: [
        {
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'Hello',
                  annotations: {
                    bold: true
                  }
                },
                type: 'text'
              }
            ]
          }
        },
        {
          bulleted_list_item: {
            rich_text: [
              {
                text: {
                  content: 'World',
                  annotations: {
                    italic: true
                  }
                },
                type: 'text'
              }
            ]
          }
        }
      ]
    };

    const expected = {
      children: [
        {
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'Hello'
                },
                annotations: {
                  bold: true
                },
                type: 'text'
              }
            ]
          }
        },
        {
          bulleted_list_item: {
            rich_text: [
              {
                text: {
                  content: 'World'
                },
                annotations: {
                  italic: true
                },
                type: 'text'
              }
            ]
          }
        }
      ]
    };

    expect(normalizeRichTextObjects(input)).toEqual(expected);
  });

  it('should preserve existing annotations at root level', () => {
    const input = {
      rich_text: [
        {
          type: 'text',
          text: {
            content: 'Content with existing annotations'
          },
          annotations: {
            bold: true
          }
        }
      ]
    };

    // Should remain unchanged
    expect(normalizeRichTextObjects(input)).toEqual(input);
  });
});

describe('normalizeRequestPayload', () => {
  it('should normalize a complex payload', () => {
    const input = {
      parent: { page_id: '123456' },
      children: [
        {
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'This is a test',
                  annotations: {
                    bold: true,
                    color: 'red'
                  }
                },
                type: 'text'
              }
            ]
          }
        },
        {
          toggle: {
            rich_text: [
              {
                text: {
                  content: 'Toggle header',
                  annotations: {
                    color: 'blue'
                  }
                },
                type: 'text'
              }
            ],
            children: [
              {
                numbered_list_item: {
                  rich_text: [
                    {
                      text: {
                        content: 'Save recording...',
                        annotations: {
                          color: 'gray'
                        }
                      },
                      type: 'text'
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    };

    const expected = {
      parent: { page_id: '123456' },
      children: [
        {
          paragraph: {
            rich_text: [
              {
                text: {
                  content: 'This is a test'
                },
                annotations: {
                  bold: true,
                  color: 'red'
                },
                type: 'text'
              }
            ]
          }
        },
        {
          toggle: {
            rich_text: [
              {
                text: {
                  content: 'Toggle header'
                },
                annotations: {
                  color: 'blue'
                },
                type: 'text'
              }
            ],
            children: [
              {
                numbered_list_item: {
                  rich_text: [
                    {
                      text: {
                        content: 'Save recording...'
                      },
                      annotations: {
                        color: 'gray'
                      },
                      type: 'text'
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    };

    expect(normalizeRequestPayload(input)).toEqual(expected);
  });
});