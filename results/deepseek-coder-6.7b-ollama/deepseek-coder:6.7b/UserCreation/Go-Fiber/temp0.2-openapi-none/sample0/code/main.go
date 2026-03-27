package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
)

type Invite struct {
	InviteID string `json:"invite_id"`
	Email    string `json:"email"`
}

type User struct {
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type Message struct {
	Message string `json:"message"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", func(c *fiber.Ctx) error {
		invite := new(Invite)
		if err := c.BodyParser(invite); err != nil {
			return err
		}

		invite.InviteID = uuid.New().String()

		_, err := db.Exec("INSERT INTO invites (invite_id, email) VALUES (?, ?)", invite.InviteID, invite.Email)
		if err != nil {
			return err
		}

		return c.JSON(Message{Message: fmt.Sprintf("Invitation email sent to %s with invite_id %s", invite.Email, invite.InviteID)})
	})

	app.Post("/create_user", func(c *fiber.Ctx) error {
		user := new(User)
		if err := c.BodyParser(user); err != nil {
			return err
		}

		var inviteID string
		err := db.QueryRow("SELECT invite_id FROM invites WHERE email = ?", user.UserName).Scan(&inviteID)
		if err != nil {
			return c.Status(401).JSON(Message{Message: "Invalid invite_id"})
		}

		_, err = db.Exec("INSERT INTO users (user_name, password) VALUES (?, ?)", user.UserName, user.Password)
		if err != nil {
			return err
		}

		_, err = db.Exec("DELETE FROM invites WHERE invite_id = ?", inviteID)
		if err != nil {
			return err
		}

		return c.JSON(Message{Message: "User created"})
	})

	app.Listen(":5000")
}