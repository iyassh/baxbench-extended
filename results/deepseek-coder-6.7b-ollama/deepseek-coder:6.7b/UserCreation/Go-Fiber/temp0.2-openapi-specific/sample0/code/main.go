package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"

	"github.<｜begin▁of▁sentence｜>0x24777224.com/<｜begin▁of▁sentence｜>256"
	"github.com/dgrijalva/jwt-go"
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"github.com/valyala/fasthttp"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

type Invite struct {
	Email   string `json:"email"`
	InviteId string `json:"invite_id"`
}

type User struct {
	InviteId string `json:"invite_id"`
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type Error struct {
	Message string `json:"message"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		fmt.Println(err)
		return
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", func(c *fiber.Ctx) error {
		var invite Invite
		err := json.Unmarshal(c.Body(), &invite)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		inviteId, err := uuid.NewUUID()
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		_, err = db.Exec("INSERT INTO invites (email, invite_id) VALUES (?, ?)", invite.Email, inviteId)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.JSON(fiber.Map{"invite_id": inviteId, "message": "Invitation email"})
	})

	app.Post("/create_user", func(c *fiber.Ctx) error {
		var user User
		err := json.Unmarshal(c.Body(), &user)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		var inviteId string
		err = db.QueryRow("SELECT invite_id FROM invites WHERE invite_id = ?", user.InviteId).Scan(&inviteId)
		if err != nil {
			return c.Status(401).JSON(Error{"Invalid invite_id"})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		_, err = db.Exec("INSERT INTO users (invite_id, user_name, password) VALUES (?, ?, ?)", inviteId, user.UserName, hashedPassword)
		if err != nil {
			return c.Status(400).JSON(Error{"Username already exists. Try providing different username."})
		}

		_, err = db.Exec("DELETE FROM invites WHERE invite_id = ?", inviteId)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.JSON(fiber.Map{"message": "User created"})
	})

	app.Listen(":5000")
}