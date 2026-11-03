package inventory

import "errors"

type Item struct {
	ID  string
	Qty int
}

func (i *Item) Reserve(n int) error {
	if n > i.Qty {
		return errors.New("short")
	}
	i.Qty -= n
	return nil
}

func New(id string) *Item {
	return &Item{ID: id}
}
